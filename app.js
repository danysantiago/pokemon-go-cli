var async = require('async')
var stdin = process.openStdin();
var PokemonGO = require('./api/poke.io.js');

var client = new PokemonGO.Pokeio();

var debug = false;
var initialized = false;

var location = {
    'type': 'name',
    'name': 'Fremont'
};

var nearbyPokemons = [];

console.log("Welcome to PokemonGO CLI!");
ask();

stdin.addListener("data", function (input) {
    var inputStr = input.toString().trim();

    if (debug) {
        console.log("[d] input entered: [" + inputStr + "]");
    }

    var inputArgs = inputStr.split(' ');
    if (inputArgs.length === 0) {
        console.log("[i] Unknown command.");
        return ask();
    }

    var cmd = inputArgs[0];

    if (cmd === "init") {
        return init(inputArgs);
    }

    if (cmd === "profile") {
        return showProfile(inputArgs);
    }

    if (cmd === "scan") {
        return scan(inputArgs);
    }

    if (cmd === "catch") {
        return capture(inputArgs);
    }

    if (cmd === "inventory") {
        return showInventory(inputArgs);
    }

    if (cmd === "help") {
        return help(inputArgs);
    }

    console.log("[i] Unknown command.");
    return ask();
});

function ask() {
    process.stdout.write("> ");
}

function init(inputArgs) {
    var username;
    var password;
    var provider;

    try {
        username = inputArgs[1];
        password = inputArgs[2];
        provider = inputArgs[3];
    } catch (err) {
        console.log('[e] Error parsing init arguments');
        console.log(err);
        return ask();
    }

    client.init(username, password, location, provider, function (err) {
        if (err) {
            console.log("[e] Error initializing.");
            console.log(err);
            return ask();
        }

        initialized = true;
        console.log('[i] Current location: ' + client.playerInfo.locationName);
        console.log('[i] lat/long/alt: : ' + client.playerInfo.latitude + ' ' + client.playerInfo.longitude + ' ' + client.playerInfo.altitude);
    
        ask();
    });
}

function showProflile(inputArgs) {
    if (!initialized) {
        console.log("[e] Error getting profile.");
        console.log("Client not initialized.");
        return ask();
    }

    client.GetProfile(function (err, profile) {
        if (err) {
            console.log("[e] Error getting profile.");
            console.log(err);
            return ask();
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

        ask();
    });
}

function scan(inputArgs) {
    if (!initialized) {
        console.log("[e] Error scanning.");
        console.log("Client not initialized.");
        return ask();
    }

    async.waterfall([
        function (callback) {
            if (inputArgs.length < 2) {
                return callback(null, location);;
            }

            try {
                var commaSplit = inputArgs[1].split(',');
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

        return ask();
    });
}

function capture(inputArgs) {
    if (!initialized) {
        console.log("[e] Error catching pokemon.");
        console.log("Client not initialized.");
        return ask();
    }

    var index = inputArgs[1];
    if (index < 0 || index >= nearbyPokemons.length) {
        console.log("[e] Error catching pokemon.");
        console.log("Invalid pokemon index.");
        return ask();
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

        return ask();
    });
}

function showInventory(inputArgs) {
    console.log("Sorry - Not yet implemented.");
    return ask();
}

function help(inputArgs) {
    console.log("Available commands:");
    console.log("  init <USERNAME> <PASSWORD> <'ptc'|'google'> - Initializes client.");
    console.log("  scan - Scan for nearby Pokemons. Catchable Pokemons will contain an index to use with the catch command.");
    console.log("  scan <LATITUDE>,<LONGITUDE> - Move and scan for Pokemons at the given coordinates.");
    console.log("  catch <INDEX> - Tries to capture previously seen nearby Pokemon while scanning.");
    console.log("  profile - Displays user profile information.");
    console.log("  inventory - Displays user inventory.");
    return ask();
}
