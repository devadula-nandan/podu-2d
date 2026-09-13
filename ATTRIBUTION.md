# Attribution

## Official artwork

Figure art is loaded at runtime from [PokeAPI/sprites](https://github.com/PokeAPI/sprites):

`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{id}.png`

`{id}` is the **PokeAPI id** from `src/content/pokeapi-ids.ts` (National Dex for base species; form-specific ids for Mega, Alolan, etc.). Shiny figures use the official-artwork `/shiny/` folder. These are the **475×475 official-artwork** stills, not the 96×96 gen-5-style battle sprites.

### Legal posture

This is **not** open-source Nintendo art.

The sprites are copyrighted by Nintendo, Game Freak, and The Pokémon Company. PokeAPI’s sprite repo has no OSI license (no `LICENSE` file). Fan clients, including PokeAPI and Pokémon Showdown, redistribute them under informal tolerance. This project does the same: runtime URLs only, no vendored dump, no claim that the pixels are free to relicense.

Dex 650+ default sprites in that repo include custom Black/White-style work from the [Smogon sprite project](https://www.smogon.com/forums/threads/sword-shield-sprite-project.3647722/), credited in the PokeAPI sprites README.

### Why this source

- Documented GitHub raw URLs; official-artwork is loaded at runtime only.
- Numeric form ids (Mega, Alolan, Dawn Wings, Rotom appliances, etc.) so variants do not silently reuse base species art.
- Official-artwork shiny folder for the printed Shiny figures.
- We do not vendor the artwork into the repo. A missing id or a 404 falls back to the two-letter disc.

### Mapping

Duel figures are keyed by **figure id**, not National Dex. `src/content/sprites.ts` derives a PokeAPI slug from `name` + `form`, then `src/content/pokeapi-ids.ts`. A missing or failed image falls back to the two-letter disc.

## Pokémon Duel

Pokémon Duel is a discontinued mobile game. This repository is an unofficial fan reimplementation. Pokémon and Pokémon character names are trademarks of Nintendo / The Pokémon Company / Game Freak.
