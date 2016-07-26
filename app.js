var vorpal = require('vorpal')();
var async = require('async');
var _ = require('underscore');
var Int64 = require('node-int64');
var Table = require('cli-table');
var stdin = process.openStdin();
var PokemonGO = require('./lib/poke.io.js');

var client = new PokemonGO.Pokeio();

var debug = false;
var initialized = false;

var location = {
    'type': 'name',
    'name': 'Oakland'
};

var nearbyPokemons = [];

console.log("Welcome to PokemonGO CLI!");

vorpal
    .command("init <username> <password> <provider> [initLocation]")
    .description('Initializes client.')
    .action(init);

vorpal
    .command("scan [lat_lon]")
    .description("Scan for nearby Pokemons. Catchable Pokemons will contain an index to use with the catch command.")
    .action(scan);

vorpal
    .command("catch [index]")
    .description("Tries to capture previously seen nearby Pokemon while scanning.")
    .action(capture);

vorpal
    .command("inventory <list> [sortBy]")
    .description("Displays user Pokemons or Items. You can sort the Pokemon list by utiling the 'sortBy' param and one of the followings: '#', 'cp', 'name' or 'recent'.")
    .action(showInventory);

vorpal
    .command("profile")
    .description("Displays user profile information.")
    .action(showProfile);

vorpal
    .delimiter('>')
    .show();

function init(inputArgs, done) {
    var username = inputArgs.username;
    var password = inputArgs.password;
    var provider = inputArgs.provider;

    if (inputArgs.initLocation) {
        location = {
            'type': 'name',
            'name': inputArgs.initLocation
        };
    }

    client.init(username, password, location, provider, function (err) {
        if (err) {
            console.log("[e] Error initializing.");
            console.log(JSON.stringify(err));
            return done();
        }

        initialized = true;
        console.log('[i] Current location: ' + client.playerInfo.locationName);
        console.log('[i] lat/long/alt: : ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);
    
        return done();
    });
}

function showProfile(inputArgs, done) {
    if (!initialized) {
        console.log("[e] Error getting profile.");
        console.log("Client not initialized.");
        return done();
    }

    client.GetProfile(function (err, profile) {
        if (err) {
            console.log("[e] Error getting profile.");
            console.log(err);
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
    if (!initialized) {
        console.log("[e] Error scanning.");
        console.log("Client not initialized.");
        return done();
    }

    async.waterfall([
        function (callback) {
            if (!('lat_lon' in inputArgs)) {
                return callback(null, location);;
            }

            try {
                var commaSplit = inputArgs.lat_lon.split(',');
                var latitude = commaSplit[0].trim();
                var longitude = commaSplit[1].trim();
                location = {
                    'type': 'coords',
                    'coords': {
                        'latitude': parseFloat(latitude),
                        'longitude': parseFloat(longitude),
                        'altitude': 0
                    }
                }

                return callback(null, location);
            } catch (err) {
                callback("Wrong scan location format. Try 'scan 37.7749,-122.4194'");
                return;
            }
        },
        client.SetLocation,
        function (newLocation, callback) {
            console.log('[i] Scanning lat/long/alt: : ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);
            callback(null);
        },
        client.Heartbeat,
        function (scan, callback) {
            for (var i = scan.cells.length - 1; i >= 0; i--) {
                if (scan.cells[i].NearbyPokemon[0]) {
                    var pokemon = client.pokemonlist[parseInt(scan.cells[i].NearbyPokemon[0].PokedexNumber)-1];
                    console.log('[+] There is a ' + pokemon.name + ' at ' + scan.cells[i].NearbyPokemon[0].DistanceMeters.toString() + ' meters');
                }
            }

            var index = 0;
            nearbyPokemons = [];
            for (i = scan.cells.length - 1; i >= 0; i--) {
                for (var j = scan.cells[i].WildPokemon.length - 1; j >= 0; j--) {
                    var currentPokemon = scan.cells[i].WildPokemon[j];
                    var pokedexInfo = client.pokemonlist[parseInt(currentPokemon.pokemon.PokemonId)-1];
                    nearbyPokemons.push({'pokemon': currentPokemon, 'pokedex': pokedexInfo});
                    console.log('[' + index + '] There is a ' + pokedexInfo.name + ' near! I can try to catch it!');
                    index++;
                }
            }

            callback(null);
        }
    ], function (err) {
        if (err) {
            console.log("[e] Error scanning.");
            console.log(err);
        }

        return done();
    });
}

function capture(inputArgs, done) {
    if (!initialized) {
        console.log("[e] Error catching pokemon.");
        console.log("Client not initialized.");
        return done();
    }

    var index = inputArgs[1];
    if (index < 0 || index >= nearbyPokemons.length) {
        console.log("[e] Error catching pokemon.");
        console.log("Invalid pokemon index.");
        return done();
    }

    var pokemonToCatch = nearbyPokemons[index].pokemon;
    var pokemonToCatchInfo = nearbyPokemons[index].pokedex;

    async.waterfall([
        client.Heartbeat,
        function (scan, callback) {
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
        },
        client.EncounterPokemon,
        function (encounterData, callback) {
            // TODO: Do some error handling here, See EncounterResponse in pokemon.proto
            console.log('[i] Encountering pokemon ' + pokemonToCatchInfo.name + '...');

            async.doUntil(
                function (doUntilFnCallback) {
                    console.log('[i] Trying to catch pokemon ' + pokemonToCatchInfo.name + '...');
                    client.CatchPokemon(pokemonToCatch, 1, 1.950, 1, 1, doUntilFnCallback);
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
            console.log("[e] Error catching scanning.");
            console.log(err);
        }

        return done();
    });
}

function showInventory(inputArgs, done) {
    if (!initialized) {
        console.log("[e] Error getting invenotry.");
        console.log("Client not initialized.");
        return done();
    }

    var itemList = inputArgs.list;

    client.GetInventory(function (err, inventory) {
        if (err) {
            console.log("[e] Error getting inventory.");
            console.log(err);
            return done();
        }

        var itemArr = inventory.inventory_delta.inventory_items;
        var pokemons = [];
        var items = [];
        var candies = [];
        var pokedexEntries = []
        var playerStats;
        _.each(itemArr, function (element) {
            var data = element.inventory_item_data;
            if (data.pokemon && !data.pokemon.is_egg) {
                pokemons.push(data.pokemon);
            } else if (data.item) {
                items.push(data.item);
            } else if (data.player_stats) {
                playerStats = data.player_stats;
            }
        });

        if (itemList === 'pokemons') {
            var sortBy = inputArgs.sortBy;
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
                    head: ['#', 'Name', 'CP', 'Capture Date']
                  , colWidths: [5, 14, 6, 42]
            });
            _.each(pokemons, function (pokemon) {
                var pokedexInfo = client.pokemonlist[parseInt(pokemon.pokemon_id)-1];
                var timeObj = pokemon.creation_time_ms;
                var int64 = new Int64(timeObj.high, timeObj.low);
                var captureDate = new Date(int64.toNumber());
                table.push([pokedexInfo.num, pokedexInfo.name, pokemon.cp, captureDate]);
            });
            console.log(table.toString());
        } else if (itemList === 'items') {
            console.log("[i] You have the following Items:");
            var table = new Table({
                    head: ['Name', 'Count']
                  , colWidths: [28, 8]
            });
            _.each(items, function (item) {
                table.push([client.itemMap[item.item].name, item.count]);
            });
            console.log(table.toString());
        } else if (itemList === 'stats') {
            console.log("[i] Level " + playerStats.level);
            var experience = new Int64(playerStats.experience.high, playerStats.experience.low);
            var nextExperience = new Int64(playerStats.next_level_xp.high, playerStats.next_level_xp.low);
            console.log("[i] XP " + experience + " / " + nextExperience);
            console.log("[i] " + playerStats.unique_pokedex_entries + " Unique Pokedex Entries.");
            console.log("[i] " + playerStats.pokemons_captured + " Pokemons captured.");
        } else {
            console.log("[i] Unknown inventory list. Try 'inventory pokemons'");
        }

        return done();
    });
}
