const vorpal = require('vorpal')();
const async = require('async');
const _ = require('underscore');
const Int64 = require('int64-native');
const Table = require('cli-table');
const yesno = require('yesno');
const opn = require('opn');
const PokemonGO = require('./lib/poke.io.js');

const client = new PokemonGO.Pokeio();

var debug = false;
var initialized = false;
var minTimeBetweenScans;
var lastScanTime = new Date();

var location = {
    'type': 'name',
    'name': 'London'
};

var coordsRegEx = /^(\-?\d+(\.\d+)?)\s?,\s?(\-?\d+(\.\d+)?)$/;

var nearbyPokemons = [];
var nearbyPokeStops = [];
var pokemons = [];
var items = [];
var candies = [];
var pokedexEntries = []
var playerStats;

console.log("Welcome to PokemonGO CLI!");

vorpal
    .command("init")
    .action(function (inputArgs, done) {
        var that = this;
        async.doUntil(function (doUntilFnCallback) {
            that.prompt([
                {
                    type: 'input',
                    name: 'provider',
                    message: "Account Type ('google'|'ptc'): "
                },
                {
                    type: 'input',
                    name: 'username',
                    message: 'Username: '
                },
                {
                    type: 'password',
                    name: 'password',
                    message: 'Password: '
                },
                {
                    type: 'input',
                    name: 'initLocation',
                    message: 'Initial Location: '
                }
            ], init(doUntilFnCallback));
        }, function (success) {
            if (!success) {
                console.log("[e] Oops, something went wrong, try again.");
            }
            return success;
        }, function() {
            return done();
        })
    })
    .hidden();

vorpal
    .command("scan [lat_lon]")
    .description("Scan for nearby Pokemons."
        + "\nCatchable Pokemons will contain an index to use with the catch command.")
    .action(scan);

vorpal
    .command("catch <index> [pokeball_id]")
    .description("Tries to capture previously seen nearby Pokemon while scanning."
        + "\nUse the scan command to get the index of the Pokemon to catch."
        + "\nUse the pokeball_id param to specify the Pokeball to use. Valid ids are: 1 = Pokeball, 2 = Great Ball, 3 = Ultra Ball, 4 = Master Ball.")
    .action(capture);

vorpal
    .command("inventory <list> [sort_by]")
    .alias('inv')
    .autocomplete(['pokemons', 'items', 'candies', 'stats'])
    .description("Displays user Pokemons, Items, Candies or Stats."
        + "\nYou can sort the Pokemon list by utilizing the 'sort_by' param and one of the followings: '#', 'cp', 'name' or 'recent'."
        + "\nYou can sort the Candies list by utilizing the 'sort_by' param and one of the followings: 'name'.")
    .action(showInventory);

vorpal
    .command("release <index>")
    .description("Transfers a Pokemon for candy."
        + "\nUse the inventory command to get the index of the Pokemon to release.")
    .action(release);

vorpal
    .command("profile")
    .description("Displays user profile information.")
    .action(showProfile);

vorpal
    .command("map")
    .description("Opens PokeVision with the current location.")
    .action(openMap);

vorpal
    .command("pokestop [index]")
    .option("-t, --travel", "Travels to the Poksetop before attempting to gather items.")
    .description("Get items from a Pokestop, or list the nearby Pokestops after a scan if no index is proivded.")
    .action(showPokestops);

vorpal
    .delimiter('>')
    .show()
    .exec('init');

function distanceCoords(lat1, lat2, lon1, lon2) {
    var R = 6371e3; // metres
    var pi = 3.14159265359;
    var φ1 = (lat1 * pi) / 180;
    var φ2 = (lat2 * pi) / 180;
    var Δφ = ((lat2-lat1) * pi) / 180;
    var Δλ = ((lon2-lon1) * pi) / 180;

    var a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ/2) * Math.sin(Δλ/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    var d = R * c;

    return d;
}

function parseCoordsString(string) {
    var commaSplit = string.split(',');
    var latitude = commaSplit[0].trim();
    var longitude = commaSplit[1].trim();
    return location = {
        'type': 'coords',
        'coords': {
            'latitude': parseFloat(latitude),
            'longitude': parseFloat(longitude),
            'altitude': 0
        }
    }    
}

function init(success) {
    return function (inputArgs) {
        var username = inputArgs.username;
        var password = inputArgs.password;
        var provider = inputArgs.provider;

        if (inputArgs.initLocation) {
            if (coordsRegEx.test(inputArgs.initLocation)) {
                parseCoordsString(inputArgs.initLocation);
            } else {
                location = {
                    'type': 'name',
                    'name': inputArgs.initLocation
                };  
            }
        }

        client.init(username, password, location, provider, function (err) {
            if (err) {
                // console.log("[e] Error initializing.");
                // console.log(JSON.stringify(err));
                return success(null, false);
            }

            initialized = true;
            console.log('[i] Get Map Objects Min Refresh Seconds: ' + client.settings.map_settings.get_map_objects_min_refresh_seconds);
            console.log('[i] Current location: ' + client.playerInfo.locationName);
            console.log('[i] lat/long/alt: ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);

            minTimeBetweenScans = client.settings.map_settings.get_map_objects_min_refresh_seconds * 1000;

            return success(null, true);
        });
    }
}

function showProfile(inputArgs, done) {
    client.GetProfile(function (err, profile) {
        if (err) {
            console.log("[e] Error getting profile.");
            console.log(JSON.stringify(err));
            return done();
        }

        console.log('[i] Username: ' + profile.username);
        console.log('[i] Poke Storage: ' + profile.poke_storage);
        console.log('[i] Item Storage: ' + profile.item_storage);

        var poke = 0;
        if (profile.currency[0].amount) {
            poke = profile.currency[0].amount;
        }

        console.log('[i] Pokecoin: ' + poke);
        console.log('[i] Stardust: ' + profile.currency[1].amount);

        return done();
    });
}

function scan(inputArgs, done) {
    async.waterfall([
        function (callback) {
            var newScanTime = new Date();
            if (Math.abs(newScanTime - lastScanTime) < minTimeBetweenScans) {
                return callback("Scan too quick, time between scans must be at least "
                    + Math.round(minTimeBetweenScans/1000) + " seconds.");
            }

            lastScanTime = newScanTime;

            if (!('lat_lon' in inputArgs)) {
                return callback(null, location);;
            }

            if (!coordsRegEx.test(inputArgs.lat_lon)) {
                return callback("Wrong scan location format. Try 'scan 37.7749,-122.4194'");
            }

            location = parseCoordsString(inputArgs.lat_lon);
            return callback(null, location);
        },
        client.SetLocation,
        function (newLocation, callback) {
            console.log('[i] Scanning lat/long/alt: : ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);
            callback(null);
        },
        client.Heartbeat,
        function (scan, callback) {
            nearbyPokemons = [];
            nearbyPokeStops = [];
            for (var i = scan.cells.length - 1; i >= 0; i--) {
                if (scan.cells[i].NearbyPokemon[0]) {
                    var pokemon = client.pokemonlist[parseInt(scan.cells[i].NearbyPokemon[0].PokedexNumber)-1];
                    console.log('[+] There is a ' + pokemon.name + ' nearby.');
                }

                for (var j = scan.cells[i].WildPokemon.length - 1; j >= 0; j--) {
                    var currentPokemon = scan.cells[i].WildPokemon[j];
                    var pokedexInfo = client.pokemonlist[parseInt(currentPokemon.pokemon.PokemonId)-1];
                    nearbyPokemons.push({'pokemon': currentPokemon, 'pokedex': pokedexInfo});
                }


                for (var j = scan.cells[i].Fort.length - 1; j >= 0; j--) {
                    var fort = scan.cells[i].Fort[j];
                    if (fort.FortType === 0) {
                        // GYM
                    } else if (fort.FortType === 1) {
                        // Pokestop
                        var lat1 = fort.Latitude;
                        var lat2 = client.playerInfo.latitude;
                        var lon1 = fort.Longitude;
                        var lon2 = client.playerInfo.longitude;
                        fort.distance = distanceCoords(lat1, lat2, lon1, lon2);
                        if (fort.distance < 200) {
                            nearbyPokeStops.push(fort);
                        }
                    }
                }
            }

            nearbyPokeStops = _.sortBy(nearbyPokeStops, 'distance');

            _.each(nearbyPokemons, function (pokemon, index) {
                console.log('[' + index + '] There is a ' + pokemon.pokedex.name + ' near! I can try to catch it!');
            });

            callback(null);
        }
    ], function (err) {
        if (err) {
            console.log("[e] Error scanning.");
            console.log(JSON.stringify(err));
        }

        return done();
    });
}

function capture(inputArgs, done) {
    var index = 'index' in inputArgs ? inputArgs.index : -1;
    if (index < 0 || index >= nearbyPokemons.length) {
        console.log("[e] Error catching pokemon.");
        console.log("Invalid pokemon index.");
        return done();
    }

    var pokeball = inputArgs.pokeball_id || 1;
    if (pokeball < 1 || pokeball > 4) {
        console.log("[e] Error catching pokemon.");
        console.log("Invalid pokeball id.");
        return done();
    }

    var pokemonToCatch = nearbyPokemons[index].pokemon;
    var pokemonToCatchInfo = nearbyPokemons[index].pokedex;

    async.waterfall([
        function (callback) {
            client.Heartbeat(function (err, scan) {
                if (err) {
                    return callback(err);
                }

                // Last scan was done less fairly recent, we are good to start encounter.
                if (Math.abs(new Date() - lastScanTime) < minTimeBetweenScans) {
                    return callback(null, pokemonToCatch);
                }

                // Last scan was done some time ago, re-scan and confirm pokemon still present.
                for (i = scan.cells.length - 1; i >= 0; i--) {
                    for (var j = scan.cells[i].WildPokemon.length - 1; j >= 0; j--) {
                        var currentPokemon = scan.cells[i].WildPokemon[j];
                        if (JSON.stringify(currentPokemon.EncounterId) === JSON.stringify(pokemonToCatch.EncounterId)) {
                            pokemonToCatch = currentPokemon;
                            callback(null, currentPokemon);
                            return;
                        }
                    }
                }

                callback("Pokemon " + pokemonToCatchInfo.name + " seem to have disappear.");
            });
        },
        client.EncounterPokemon,
        function (encounterData, callback) {
            // TODO: Do some error handling here, See EncounterResponse in pokemon.proto
            console.log('[i] Encountering pokemon ' + pokemonToCatchInfo.name + '...');

            async.doUntil(
                function (doUntilFnCallback) {
                    setTimeout(function () { // Delay the catch reuqest to avoid failed attempts too quick.
                        console.log('[i] Trying to catch pokemon ' + pokemonToCatchInfo.name + '...');
                        client.CatchPokemon(pokemonToCatch, 1, 1.950, 1, pokeball, doUntilFnCallback);
                    }, 2000);  
                },
                function (catchResult) {
                    var statusStr = ['Unexpected error', 'Successful catch', 'Catch Escape', 'Catch Flee', 'Missed Catch'];
                    var catchStatus = catchResult.Status;
                    console.log('[i] ' + statusStr[catchStatus]);
                    return catchStatus === 0 || catchStatus === 1 || catchStatus === 3;
                },
                callback
            );
        }
    ], function (err) {
        if (err) {
            console.log("[e] Error catching pokemon.");
            console.log(JSON.stringify(err));
        }

        return done();
    });
}

function showInventory(inputArgs, done) {
    var itemList = inputArgs.list;

    client.GetInventory(function (err, inventory) {
        if (err) {
            console.log("[e] Error getting inventory.");
            console.log(JSON.stringify(err));
            return done();
        }

        var itemArr = inventory.inventory_delta.inventory_items;
        pokemons = [];
        items = [];
        candies = [];
        pokedexEntries = []
        playerStats;

        _.each(itemArr, function (element) {
            var data = element.inventory_item_data;
            if (data.pokemon && !data.pokemon.is_egg) {
                pokemons.push(data.pokemon);
            } else if (data.item) {
                items.push(data.item);
            } else if (data.player_stats) {
                playerStats = data.player_stats;
            } else if (data.pokemon_family) {
                candies.push(data.pokemon_family);
            }
        });

        if (itemList === 'pokemons') {
            var sortBy = inputArgs.sort_by;
            if (sortBy === "cp") {
                pokemons = _.sortBy(pokemons, 'cp');
            } else if (sortBy === "#") {
                pokemons = _.sortBy(pokemons, 'pokemon_id');
            } else if (sortBy === "name") {
                pokemons = _.sortBy(pokemons, function (element) {
                    var pokedexInfo = client.pokemonlist[parseInt(element.pokemon_id)-1];
                    return pokedexInfo.name;
                });
            } else if (sortBy === "recent") {
                pokemons = _.sortBy(pokemons, function (element) {
                    var timeObj = element.creation_time_ms;
                    var int64 = new Int64(timeObj.high, timeObj.low);
                    return int64.toNumber();
                });
            }

            console.log("[i] You have the following Pokemons:");
            var table = new Table({
                head: ['i', '#', 'Name', 'CP', 'Capture Date'],
                colWidths: [5, 5, 14, 6, 42]
            });
            _.each(pokemons, function (pokemon, index) {
                var pokedexInfo = client.pokemonlist[parseInt(pokemon.pokemon_id)-1];
                var timeObj = pokemon.creation_time_ms;
                var int64 = new Int64(timeObj.high, timeObj.low);
                var captureDate = new Date(int64.toNumber());
                table.push([index, pokedexInfo.num, pokedexInfo.name, pokemon.cp, captureDate]);
            });
            console.log(table.toString());
        } else if (itemList === 'items') {
            console.log("[i] You have the following Items:");
            var table = new Table({
                head: ['Id', 'Name', 'Count'],
                colWidths: [8, 28, 8]
            });
            items = _.sortBy(items, 'item');
            _.each(items, function (item) {
                if (item.count) {
                    var itemInfo = client.itemMap[item.item];
                    table.push([item.item, itemInfo.name, item.count]);
                }
            });
            console.log(table.toString());
        } else if (itemList === 'stats') {
            console.log("[i] Level " + playerStats.level);
            var experience = new Int64(playerStats.experience.high, playerStats.experience.low);
            var nextExperience = new Int64(playerStats.next_level_xp.high, playerStats.next_level_xp.low);
            console.log("[i] XP " + experience + " / " + nextExperience);
            console.log("[i] " + playerStats.unique_pokedex_entries + " Unique Pokedex Entries.");
            console.log("[i] " + playerStats.pokemons_captured + " Pokemons captured.");
        } else if (itemList === 'candies') {
            var sortBy = inputArgs.sort_by;
            if (sortBy === "name") {
                candies = _.sortBy(candies, function (element) {
                    var pokedexInfo = client.pokemonlist[parseInt(element.family_id)-1];
                    return pokedexInfo.name;
                });
            } else {
                candies = _.sortBy(candies, 'family_id');
            }

            console.log("[i] You have the following Candy:");
            var table = new Table({
                head: ['Name', 'Count'],
                colWidths: [28, 8]
            });
            _.each(candies, function (candy) {
                var pokedexInfo = client.pokemonlist[parseInt(candy.family_id)-1];
                table.push([pokedexInfo.name, candy.candy]);
            });
            console.log(table.toString());
        } else {
            console.log("[i] Unknown inventory list. Try 'inventory pokemons'");
        }

        return done();
    });
}

function release(inputArgs, done) {
    var index = 'index' in inputArgs ? inputArgs.index : -1;
    if (index < 0 || index >= pokemons.length) {
        console.log("[e] Error releasing pokemon.");
        console.log("Invalid pokemon index.");
        return done();
    }

    var pokemon = pokemons[index];
    var timeObj = pokemon.creation_time_ms;
    var int64 = new Int64(timeObj.high, timeObj.low);
    var captureDate = new Date(int64.toNumber());
    var pokedexInfo = client.pokemonlist[parseInt(pokemon.pokemon_id)-1];
    console.log("[i] About to release:");
    console.log(pokedexInfo.name + ", CP = " + pokemon.cp + ", Capture Date = " + captureDate);
    yesno.ask("[!] Are you sure you want to continue?", false, function (ok) {
        if (!ok) {
            console.log("[i] Pokemon not released.");
            return done();
        }

        var pokemonId = new Int64(pokemon.id.high, pokemon.id.low);
        client.ReleasePokemon(pokemonId.toUnsignedDecimalString(), function (err, releaseData) {
            if (err) {
                console.log("[e] Error releasing pokemon.");
                console.log(JSON.stringify(err));
                return done();
            }

            //TODO: Do status handling here. See ReleasePokemonResponse in pokemon.proto
            console.log("[i] Bye bye " + pokedexInfo.name + "...");
            return done();
        });
    });
}

function openMap(inputArgs, done) {
    var url = "https://pokevision.com/#/@";
    opn(url + client.playerInfo.latitude + ',' + client.playerInfo.longitude, {app: 'google chrome'});
    return done();
}

function showPokestops(inputArgs, done) {
    if (!('index' in inputArgs)) {
        _.each(nearbyPokeStops, function (fort, index) {
            console.log("[" + index + "] There is a nearby PokeStop "
                + Math.round(fort.distance) + " meters away at "
                + fort.Latitude + "," + fort.Longitude);
        });
        return done();
    }

    var index = inputArgs.index;
    if (index < 0 || index >= nearbyPokeStops.length) {
        console.log("[e] Error getting Pokestop.");
        console.log("Invalid pokemon index.");
        return done();
    }

    var fort = nearbyPokeStops[index];
    client.GetFort(fort.FortId, fort.Latitude, fort.Longitude, function (err, getData) {
        if (err) {
            console.log("[e] Error getting Pokestop.");
            console.log(JSON.stringify(err));
            return done();
        }

        if (getData.result != 1) {
            var statusStr = ['unexpected error', 'success', 'out of range', 'too soon, still in cooldown period', 'your inventory is full'];
            console.log("[e] Unable to get items from Pokestop, " + statusStr[getData.result] + ".");
            return done();
        }

        console.log("Got the following items:");
        _.each(getData.items_awarded, function (item) {
            console.log(client.itemMap[item.item_id].name + " x" + item.item_count);
        });

        return done();
    });
}
