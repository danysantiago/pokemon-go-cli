# Pokemong GO CLI

### Usage:
Initialize by logging in with your Pokemon Trainer Club or Google account.
```
Welcome to PokemonGO CLI!
>
Account Type ('google'|'ptc'): ptc
Username: MY_USERNAME
Password: ***********
```
Use the scan command to look for nearby Pokemons.
```
> scan
[i] Scanning lat/long/alt: : *** ***
[+] There is a Pidgey at 200 meters
```
Seems like a Pidgey is close, go directly to him!
```
> scan <LATITUDE>,<LONGITUDE>
[i] Scanning lat/long/alt: : *** *** ***
[+] There is a Paras at 200 meters
[+] There is a Rattata at 200 meters
[0] There is a Pidgey near! I can try to catch it!
```
Catch that Pidgey!
```
> catch 0
[i] Encountering pokemon Pidgey...
[i] Trying to catch pokemon Pidgey...
[i] Successful catch
```
For more commands and help try `> help`

### Setup:
1. Do `npm install` at root of cloned repo folder.

### Warning:
As usual, this utilizes un-official Niantic api, beware, you might get banned.

### Note:
* If your Google account has two-factor authentication, you will need to create an app password. See: https://support.google.com/accounts/answer/185833?hl=en.
* This interface was built on top of https://github.com/Armax/Pokemon-GO-node-api, thanks!
