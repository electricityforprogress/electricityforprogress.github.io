(function () {
  "use strict";

  const TYPE_NAMES = {
    0x00: "Normal",
    0x01: "Fighting",
    0x02: "Flying",
    0x03: "Poison",
    0x04: "Ground",
    0x05: "Rock",
    0x07: "Bug",
    0x08: "Ghost",
    0x14: "Fire",
    0x15: "Water",
    0x16: "Grass",
    0x17: "Electric",
    0x18: "Psychic",
    0x19: "Ice",
    0x1A: "Dragon"
  };

  const MOVES_LIST = [
    { id: 0x00, name: "(Empty Slot)", pp: 0, type: 0x00 },
    { id: 0x5E, name: "Psychic", pp: 10, type: 0x18 },
    { id: 0x85, name: "Amnesia", pp: 20, type: 0x18 },
    { id: 0x3B, name: "Blizzard", pp: 5, type: 0x19 },
    { id: 0x3A, name: "Ice Beam", pp: 10, type: 0x19 },
    { id: 0x55, name: "Thunderbolt", pp: 15, type: 0x17 },
    { id: 0x56, name: "Thunder Wave", pp: 20, type: 0x17 },
    { id: 0x57, name: "Thunder", pp: 10, type: 0x17 },
    { id: 0x22, name: "Body Slam", pp: 15, type: 0x00 },
    { id: 0x3F, name: "Hyper Beam", pp: 5, type: 0x00 },
    { id: 0x26, name: "Double-Edge", pp: 15, type: 0x00 },
    { id: 0xA3, name: "Slash", pp: 20, type: 0x00 },
    { id: 0x62, name: "Quick Attack", pp: 30, type: 0x00 },
    { id: 0x81, name: "Swift", pp: 20, type: 0x00 },
    { id: 0xA1, name: "Tri Attack", pp: 10, type: 0x00 },
    { id: 0x0E, name: "Swords Dance", pp: 30, type: 0x00 },
    { id: 0x69, name: "Recover", pp: 20, type: 0x00 },
    { id: 0x87, name: "Soft-Boiled", pp: 10, type: 0x00 },
    { id: 0x99, name: "Explosion", pp: 5, type: 0x00 },
    { id: 0xA4, name: "Substitute", pp: 10, type: 0x00 },
    { id: 0x8E, name: "Lovely Kiss", pp: 10, type: 0x00 },
    { id: 0x90, name: "Transform", pp: 10, type: 0x00 },
    { id: 0x96, name: "Splash", pp: 40, type: 0x00 },
    { id: 0x59, name: "Earthquake", pp: 10, type: 0x04 },
    { id: 0x5B, name: "Dig", pp: 10, type: 0x04 },
    { id: 0x9D, name: "Rock Slide", pp: 10, type: 0x05 },
    { id: 0x39, name: "Surf", pp: 15, type: 0x15 },
    { id: 0x38, name: "Hydro Pump", pp: 5, type: 0x15 },
    { id: 0x3D, name: "Bubble Beam", pp: 20, type: 0x15 },
    { id: 0x98, name: "Crabhammer", pp: 10, type: 0x15 },
    { id: 0x7F, name: "Waterfall", pp: 15, type: 0x15 },
    { id: 0x35, name: "Flamethrower", pp: 15, type: 0x14 },
    { id: 0x7E, name: "Fire Blast", pp: 5, type: 0x14 },
    { id: 0x07, name: "Fire Punch", pp: 15, type: 0x14 },
    { id: 0x08, name: "Ice Punch", pp: 15, type: 0x19 },
    { id: 0x09, name: "Thunder Punch", pp: 15, type: 0x17 },
    { id: 0x4B, name: "Razor Leaf", pp: 25, type: 0x16 },
    { id: 0x48, name: "Mega Drain", pp: 10, type: 0x16 },
    { id: 0x4C, name: "Solar Beam", pp: 10, type: 0x16 },
    { id: 0x4F, name: "Sleep Powder", pp: 15, type: 0x16 },
    { id: 0x5F, name: "Hypnosis", pp: 20, type: 0x18 },
    { id: 0x73, name: "Reflect", pp: 20, type: 0x18 },
    { id: 0x61, name: "Agility", pp: 30, type: 0x18 },
    { id: 0x9C, name: "Rest", pp: 10, type: 0x18 },
    { id: 0x41, name: "Drill Peck", pp: 20, type: 0x02 },
    { id: 0x13, name: "Fly", pp: 15, type: 0x02 },
    { id: 0x8F, name: "Sky Attack", pp: 5, type: 0x02 },
    { id: 0x42, name: "Submission", pp: 25, type: 0x01 },
    { id: 0x45, name: "Seismic Toss", pp: 20, type: 0x01 },
    { id: 0x88, name: "High Jump Kick", pp: 20, type: 0x01 },
    { id: 0x7C, name: "Sludge", pp: 20, type: 0x03 },
    { id: 0x5C, name: "Toxic", pp: 10, type: 0x03 },
    { id: 0x2A, name: "Pin Missile", pp: 20, type: 0x07 },
    { id: 0x8D, name: "Leech Life", pp: 15, type: 0x07 },
    { id: 0x65, name: "Night Shade", pp: 15, type: 0x08 },
    { id: 0x52, name: "Dragon Rage", pp: 10, type: 0x1A }
  ];

  const RAW_151 = [
    [1, "Bulbasaur", 0x99, 0x16, 0x03, "mediumSlow", 45, 49, 49, 45, 65, [0x4B, 0x4F, 0x22, 0x48], "A strange seed was planted on its back at birth. The plant sprouts and grows with this Pokémon."],
    [2, "Ivysaur", 0x09, 0x16, 0x03, "mediumSlow", 60, 62, 63, 60, 80, [0x4B, 0x4F, 0x22, 0x4C], "When the bulb on its back grows large, it appears to lose the ability to stand on its hind legs."],
    [3, "Venusaur", 0x9A, 0x16, 0x03, "mediumSlow", 80, 82, 83, 80, 100, [0x4B, 0x4F, 0x22, 0x0E], "The plant blooms when it is absorbing solar energy. It stays on the move to seek sunlight."],
    [4, "Charmander", 0xB0, 0x14, 0x14, "mediumSlow", 39, 52, 43, 65, 50, [0x35, 0xA3, 0x22, 0x5B], "Obviously prefers hot places. When it rains, steam is said to spout from the tip of its tail."],
    [5, "Charmeleon", 0xB2, 0x14, 0x14, "mediumSlow", 58, 64, 58, 80, 65, [0x35, 0xA3, 0x22, 0x5B], "When it swings its burning tail, it elevates the temperature to unbearably high levels."],
    [6, "Charizard", 0xB4, 0x14, 0x02, "mediumSlow", 78, 84, 78, 100, 85, [0x7E, 0x59, 0x0E, 0x22], "Spits fire that is hot enough to melt boulders. Known to cause forest fires unintentionally."],
    [7, "Squirtle", 0xB1, 0x15, 0x15, "mediumSlow", 44, 48, 65, 43, 50, [0x39, 0x3A, 0x22, 0x5B], "Shoots water at prey while in the water. Withdraws into its shell when in danger."],
    [8, "Wartortle", 0xB3, 0x15, 0x15, "mediumSlow", 59, 63, 80, 58, 65, [0x39, 0x3A, 0x22, 0x9C], "Often hides in water to stalk unwary prey. For swimming fast, it moves its ears to maintain balance."],
    [9, "Blastoise", 0x1C, 0x15, 0x15, "mediumSlow", 79, 83, 100, 78, 85, [0x38, 0x3B, 0x59, 0x22], "A brutal Pokémon with pressurized water jets on its shell. They are used for high speed tackles."],
    [10, "Caterpie", 0x7B, 0x07, 0x07, "mediumFast", 45, 30, 35, 45, 20, [0x26, 0x81, 0xA4, 0x00], "Its short feet are tipped with suction pads that enable it to tirelessly climb slopes and walls."],
    [11, "Metapod", 0x7C, 0x07, 0x07, "mediumFast", 50, 20, 55, 30, 25, [0x26, 0xA4, 0x00, 0x00], "This Pokémon is vulnerable to attack while its shell is soft, exposing its weak and tender body."],
    [12, "Butterfree", 0x7D, 0x07, 0x02, "mediumFast", 60, 45, 50, 70, 80, [0x4F, 0x5E, 0x48, 0x81], "In battle, it flaps its wings at high speed to release highly toxic dust into the air."],
    [13, "Weedle", 0x70, 0x07, 0x03, "mediumFast", 40, 35, 30, 50, 20, [0x2A, 0x5C, 0x00, 0x00], "Often found in forests, eating leaves. It has a sharp venomous stinger on its head."],
    [14, "Kakuna", 0x71, 0x07, 0x03, "mediumFast", 45, 25, 50, 35, 25, [0x2A, 0x5C, 0x00, 0x00], "Almost incapable of moving, this Pokémon can only harden its shell to protect itself."],
    [15, "Beedrill", 0x72, 0x07, 0x03, "mediumFast", 65, 80, 40, 75, 45, [0x2A, 0x0E, 0x3F, 0x48], "Flies at high speed and attacks using its large venomous stingers on its forelegs and tail."],
    [16, "Pidgey", 0x24, 0x00, 0x02, "mediumSlow", 40, 45, 40, 56, 35, [0x62, 0x13, 0x26, 0x81], "A common sight in forests and woods. It flaps its wings at ground level to kick up blinding sand."],
    [17, "Pidgeotto", 0x96, 0x00, 0x02, "mediumSlow", 63, 60, 55, 71, 50, [0x13, 0x26, 0x62, 0x61], "Very protective of its sprawling territorial area, this Pokémon will fiercely peck at any intruder."],
    [18, "Pidgeot", 0x97, 0x00, 0x02, "mediumSlow", 83, 80, 75, 91, 70, [0x26, 0x3F, 0x13, 0x62], "When hunting, it skims the surface of water at high speed to pick off unwary prey such as Magikarp."],
    [19, "Rattata", 0xA5, 0x00, 0x00, "mediumFast", 30, 56, 35, 72, 25, [0x22, 0x62, 0x3B, 0x55], "Bites anything when it attacks. Small and very quick, it is a common sight in many places."],
    [20, "Raticate", 0xA6, 0x00, 0x00, "mediumFast", 55, 81, 60, 97, 50, [0x22, 0x3F, 0x3B, 0x55], "It uses its whiskers to maintain its balance. It apparently slows down if they are cut off."],
    [21, "Spearow", 0x05, 0x00, 0x02, "mediumFast", 40, 60, 30, 70, 31, [0x41, 0x26, 0x61, 0x81], "Eats bugs in grassy areas. It has to flap its short wings at high speed to stay airborne."],
    [22, "Fearow", 0x23, 0x00, 0x02, "mediumFast", 65, 90, 65, 100, 61, [0x41, 0x26, 0x3F, 0x61], "With its huge and magnificent wings, it can keep aloft without ever having to land for rest."],
    [23, "Ekans", 0x6C, 0x03, 0x03, "mediumFast", 35, 60, 44, 55, 40, [0x22, 0x59, 0x7C, 0x9D], "Moves silently and stealthily. Eats the eggs of birds, such as Pidgey and Spearow, whole."],
    [24, "Arbok", 0x2D, 0x03, 0x03, "mediumFast", 60, 85, 69, 80, 65, [0x59, 0x22, 0x9D, 0x7C], "It is rumored that the ferocious warning markings on its belly differ from area to area."],
    [25, "Pikachu", 0x54, 0x17, 0x17, "mediumFast", 35, 55, 30, 90, 50, [0x55, 0x39, 0x56, 0x62], "When several of these Pokémon gather, their electricity could build and cause lightning storms."],
    [26, "Raichu", 0x55, 0x17, 0x17, "mediumFast", 60, 90, 55, 100, 90, [0x55, 0x39, 0x22, 0x56], "Its long tail serves as a ground to protect itself from its own high voltage power."],
    [27, "Sandshrew", 0x60, 0x04, 0x04, "mediumFast", 50, 75, 85, 40, 30, [0x59, 0x9D, 0x0E, 0x22], "Burrows deep underground in arid locations far from water. It only emerges to hunt for food."],
    [28, "Sandslash", 0x61, 0x04, 0x04, "mediumFast", 75, 100, 110, 65, 55, [0x59, 0x9D, 0x0E, 0x3F], "Curls up into a spiny ball when threatened. It can roll while curled up to attack or escape."],
    [29, "Nidoran♀", 0x0F, 0x03, 0x03, "mediumSlow", 55, 47, 52, 41, 40, [0x22, 0x3B, 0x55, 0x5C], "Although small, its venomous barbs render this Pokémon dangerous. The female has smaller horns."],
    [30, "Nidorina", 0xA8, 0x03, 0x03, "mediumSlow", 70, 62, 67, 56, 55, [0x22, 0x3B, 0x55, 0x3D], "The female's horn develops slowly. Prefers physical attacks such as clawing and biting."],
    [31, "Nidoqueen", 0x10, 0x03, 0x04, "mediumSlow", 90, 82, 87, 76, 75, [0x59, 0x3B, 0x55, 0x22], "Its hard scales provide strong protection. It uses its hefty bulk to execute powerful moves."],
    [32, "Nidoran♂", 0x03, 0x03, 0x03, "mediumSlow", 46, 57, 40, 50, 40, [0x22, 0x3B, 0x55, 0x5C], "Stiffens its ears to sense danger. The larger its horns, the more powerful its secreted venom."],
    [33, "Nidorino", 0xA7, 0x03, 0x03, "mediumSlow", 61, 72, 57, 65, 55, [0x22, 0x3B, 0x55, 0x3D], "An aggressive Pokémon that is quick to attack. The horn on its head secretes a powerful venom."],
    [34, "Nidoking", 0x07, 0x03, 0x04, "mediumSlow", 81, 92, 77, 85, 75, [0x59, 0x3B, 0x55, 0x9D], "It uses its powerful tail in battle to smash, constrict, then break the prey's bones."],
    [35, "Clefairy", 0x04, 0x00, 0x00, "fast", 70, 45, 48, 35, 60, [0x22, 0x3B, 0x55, 0x56], "Its magical and cute appeal has many admirers. It is rare and found only in certain areas."],
    [36, "Clefable", 0x8E, 0x00, 0x00, "fast", 95, 70, 73, 60, 85, [0x3B, 0x55, 0x22, 0x56], "A timid fairy Pokémon that is rarely seen. It will run and hide the moment it senses people."],
    [37, "Vulpix", 0x52, 0x14, 0x14, "mediumFast", 38, 41, 40, 65, 65, [0x35, 0x22, 0x62, 0x5B], "At the time of birth, it has just one tail. The tail splits from its tip as it grows older."],
    [38, "Ninetales", 0x53, 0x14, 0x14, "mediumFast", 73, 76, 75, 100, 100, [0x7E, 0x22, 0x62, 0x3F], "Very smart and very vengeful. Grabbing one of its many tails could result in a 1000-year curse."],
    [39, "Jigglypuff", 0x64, 0x00, 0x00, "fast", 115, 45, 20, 20, 25, [0x22, 0x3A, 0x55, 0x9C], "When its huge eyes light up, it sings a mysteriously soothing melody that lulls its enemies to sleep."],
    [40, "Wigglytuff", 0x65, 0x00, 0x00, "fast", 140, 70, 45, 45, 50, [0x22, 0x3B, 0x55, 0x3F], "The body is soft and rubbery. When angered, it will suck in air and inflate itself to an enormous size."],
    [41, "Zubat", 0x6B, 0x03, 0x02, "mediumFast", 40, 45, 35, 55, 40, [0x26, 0x48, 0x5C, 0x8D], "Forms colonies in perpetually dark places. Uses ultrasonic waves to identify and approach targets."],
    [42, "Golbat", 0x82, 0x03, 0x02, "mediumFast", 75, 80, 70, 90, 75, [0x26, 0x3F, 0x48, 0x5C], "Once it strikes, it will not stop draining energy from the victim even if it gets too heavy to fly."],
    [43, "Oddish", 0xB9, 0x16, 0x03, "mediumSlow", 45, 50, 55, 30, 75, [0x4F, 0x48, 0x4C, 0x5C], "During the day, it keeps its face buried in the ground. At night, it wanders around sowing its seeds."],
    [44, "Gloom", 0xBA, 0x16, 0x03, "mediumSlow", 60, 65, 70, 40, 85, [0x4F, 0x48, 0x4C, 0x22], "The fluid that oozes from its mouth isn't drool. It is a nectar that is used to attract prey."],
    [45, "Vileplume", 0xBB, 0x16, 0x03, "mediumSlow", 75, 80, 85, 50, 100, [0x4F, 0x0E, 0x22, 0x48], "The larger its petals, the more toxic pollen it contains. Its big head is heavy and hard to hold up."],
    [46, "Paras", 0x6D, 0x07, 0x16, "mediumFast", 35, 70, 55, 25, 55, [0x4F, 0xA3, 0x5B, 0x48], "Burrows to suck tree roots. The mushrooms on its back grow by drawing nutrients from the bug host."],
    [47, "Parasect", 0x2E, 0x07, 0x16, "mediumFast", 60, 95, 80, 30, 80, [0x4F, 0x0E, 0x22, 0x5B], "A host-parasite pair in which the parasite mushroom has taken over the host bug."],
    [48, "Venonat", 0x41, 0x07, 0x03, "mediumFast", 60, 55, 50, 45, 40, [0x4F, 0x5E, 0x48, 0x26], "Lives in the shadows of tall trees where it eats insects. It is attracted by light at night."],
    [49, "Venomoth", 0x77, 0x07, 0x03, "mediumFast", 70, 65, 60, 90, 90, [0x4F, 0x5E, 0x48, 0x26], "The dust-like scales covering its wings are color coded to indicate the kinds of poison it has."],
    [50, "Diglett", 0x3B, 0x04, 0x04, "mediumFast", 10, 55, 25, 95, 45, [0x59, 0x9D, 0xA3, 0x22], "Lives about one yard underground where it feeds on plant roots. It sometimes appears above ground."],
    [51, "Dugtrio", 0x76, 0x04, 0x04, "mediumFast", 35, 80, 50, 120, 70, [0x59, 0x9D, 0xA3, 0xA4], "A team of Diglett triplets. It triggers huge earthquakes by burrowing 60 miles underground."],
    [52, "Meowth", 0x4D, 0x00, 0x00, "mediumFast", 40, 45, 35, 90, 40, [0xA3, 0x22, 0x3D, 0x55], "Adores circular objects. Wanders the streets on a nightly basis to look for dropped loose change."],
    [53, "Persian", 0x90, 0x00, 0x00, "mediumFast", 65, 70, 60, 115, 65, [0xA3, 0x22, 0x3D, 0x55], "Although its fur has many admirers, it is tough to raise as a pet because of its fickle meanness."],
    [54, "Psyduck", 0x2F, 0x15, 0x15, "mediumFast", 50, 52, 48, 55, 50, [0x39, 0x3A, 0x22, 0x45], "While lulling its enemies with its vacant look, this wily Pokémon will use psychokinetic powers."],
    [55, "Golduck", 0x80, 0x15, 0x15, "mediumFast", 80, 82, 78, 85, 80, [0x85, 0x38, 0x3B, 0x22], "Often seen swimming elegantly by dusk shores. It is often mistaken for the Japanese monster, Kappa."],
    [56, "Mankey", 0x39, 0x01, 0x01, "mediumFast", 40, 80, 35, 70, 35, [0x42, 0x9D, 0x22, 0x55], "Extremely quick to anger. It could be docile one moment then thrashing away the next instant."],
    [57, "Primeape", 0x75, 0x01, 0x01, "mediumFast", 65, 105, 60, 95, 60, [0x42, 0x9D, 0x22, 0x3F], "Always furious and tenacious to boot. It will not abandon chasing its quarry until it is caught."],
    [58, "Growlithe", 0x21, 0x14, 0x14, "slow", 55, 70, 45, 60, 50, [0x35, 0x22, 0x5B, 0x61], "Very protective of its territory. It will bark and bite to repel intruders from its space."],
    [59, "Arcanine", 0x14, 0x14, 0x14, "slow", 90, 110, 80, 95, 80, [0x7E, 0x22, 0x3F, 0x5B], "A Pokémon that has been admired since the past for its beauty. It runs agilely as if on wings."],
    [60, "Poliwag", 0x47, 0x15, 0x15, "mediumSlow", 40, 50, 40, 90, 40, [0x5F, 0x85, 0x39, 0x3A], "Its newly grown legs prevent it from running. It appears to prefer swimming than trying to stand."],
    [61, "Poliwhirl", 0x6E, 0x15, 0x15, "mediumSlow", 65, 65, 65, 90, 50, [0x5F, 0x85, 0x39, 0x3A], "Capable of living in or out of water. When out of water, it sweats to keep its body slimy."],
    [62, "Poliwrath", 0x6F, 0x15, 0x01, "mediumSlow", 90, 85, 95, 70, 70, [0x5F, 0x85, 0x39, 0x59], "An adept swimmer at both the front crawl and breaststroke. Easily overtakes the best human swimmers."],
    [63, "Abra", 0x94, 0x18, 0x18, "mediumSlow", 25, 20, 15, 90, 105, [0x5E, 0x56, 0x45, 0x73], "Using its ability to read minds, it will identify impending danger and Teleport to safety."],
    [64, "Kadabra", 0x26, 0x18, 0x18, "mediumSlow", 40, 35, 30, 105, 120, [0x5E, 0x69, 0x56, 0x73], "It emits special alpha waves from its body that induce headaches just by being close by."],
    [65, "Alakazam", 0x95, 0x18, 0x18, "mediumSlow", 55, 50, 45, 120, 135, [0x5E, 0x69, 0x56, 0x73], "Its brain can outperform a supercomputer. Its intelligence quotient is said to be 5,000."],
    [66, "Machop", 0x6A, 0x01, 0x01, "mediumSlow", 70, 80, 50, 35, 35, [0x42, 0x59, 0x9D, 0x22], "Loves to build its muscles. It trains in all styles of martial arts to become even stronger."],
    [67, "Machoke", 0x29, 0x01, 0x01, "mediumSlow", 80, 100, 70, 45, 50, [0x42, 0x59, 0x9D, 0x22], "Its muscular body is so powerful, it must wear a power save belt to be able to regulate its motions."],
    [68, "Machamp", 0x7E, 0x01, 0x01, "mediumSlow", 90, 130, 80, 55, 65, [0x42, 0x59, 0x9D, 0x3F], "Using its heavy muscles, it throws powerful punches that can send the victim clear over the horizon."],
    [69, "Bellsprout", 0xBC, 0x16, 0x03, "mediumSlow", 50, 75, 35, 40, 70, [0x4F, 0x4B, 0x0E, 0x26], "A carnivorous Pokémon that traps and eats bugs. It uses its root feet to soak up needed moisture."],
    [70, "Weepinbell", 0xBD, 0x16, 0x03, "mediumSlow", 65, 90, 50, 55, 85, [0x4F, 0x4B, 0x0E, 0x26], "It spits out PoisonPowder to immobilize the enemy and then finishes it with a spray of Acid."],
    [71, "Victreebel", 0xBE, 0x16, 0x03, "mediumSlow", 80, 105, 65, 70, 100, [0x4F, 0x4B, 0x0E, 0x3F], "Said to live in huge colonies deep in jungles, although no one has ever returned from there."],
    [72, "Tentacool", 0x18, 0x15, 0x03, "slow", 40, 40, 35, 70, 100, [0x39, 0x3B, 0x48, 0x0E], "Drifts in shallow seas. Anglers who hook them by accident are often punished by its stinging acid."],
    [73, "Tentacruel", 0x9B, 0x15, 0x03, "slow", 80, 70, 65, 100, 120, [0x39, 0x3B, 0x0E, 0x3F], "The tentacles are normally kept short. On hunts, they are extended to ensnare and immobilize prey."],
    [74, "Geodude", 0xA9, 0x05, 0x04, "mediumSlow", 40, 80, 100, 20, 30, [0x59, 0x9D, 0x22, 0x99], "Found in fields and mountains. Mistaking them for boulders, people often step or trip on them."],
    [75, "Graveler", 0x27, 0x05, 0x04, "mediumSlow", 55, 95, 115, 35, 45, [0x59, 0x9D, 0x22, 0x99], "Rolls down slopes to move. It rolls over any obstacle without slowing or changing its direction."],
    [76, "Golem", 0x31, 0x05, 0x04, "mediumSlow", 80, 110, 130, 45, 55, [0x59, 0x9D, 0x22, 0x99], "Its boulder-like body is extremely hard. It can easily withstand dynamite blasts without damage."],
    [77, "Ponyta", 0xA3, 0x14, 0x14, "mediumFast", 50, 85, 55, 90, 65, [0x7E, 0x22, 0x61, 0x26], "Its hooves are 10 times harder than diamonds. It can trample anything completely flat in little time."],
    [78, "Rapidash", 0xA4, 0x14, 0x14, "mediumFast", 65, 100, 70, 105, 80, [0x7E, 0x22, 0x3F, 0x61], "Very competitive, this Pokémon will chase anything that moves fast in the hopes of racing it."],
    [79, "Slowpoke", 0x25, 0x15, 0x18, "mediumFast", 90, 65, 65, 15, 40, [0x85, 0x39, 0x5E, 0x56], "Incredibly slow and dopey. It takes 5 seconds for it to feel pain when under attack."],
    [80, "Slowbro", 0x08, 0x15, 0x18, "mediumFast", 95, 75, 110, 30, 80, [0x85, 0x39, 0x5E, 0x9C], "The Shellder that is latched onto Slowpoke's tail is said to feed on the host's left over scraps."],
    [81, "Magnemite", 0xAD, 0x17, 0x17, "mediumFast", 25, 35, 70, 45, 95, [0x55, 0x56, 0x26, 0x81], "Uses anti-gravity to stay suspended. Appears without warning and uses Thunder Wave and similar moves."],
    [82, "Magneton", 0x36, 0x17, 0x17, "mediumFast", 50, 60, 95, 70, 120, [0x55, 0x56, 0x3F, 0xA4], "Formed by several Magnemites linked together. They frequently appear when sunspots flare up."],
    [83, "Farfetch'd", 0x40, 0x00, 0x02, "mediumFast", 52, 65, 55, 60, 58, [0xA3, 0x0E, 0x22, 0x13], "The sprig of green onions it holds is its weapon. It is used much like a metal sword."],
    [84, "Doduo", 0x46, 0x00, 0x02, "mediumFast", 35, 85, 45, 75, 35, [0x41, 0x22, 0x26, 0x61], "A bird that makes up for its poor flying with its fast foot speed. Leaves giant footprints."],
    [85, "Dodrio", 0x74, 0x00, 0x02, "mediumFast", 60, 110, 70, 100, 60, [0x41, 0x22, 0x3F, 0xA1], "Uses its three brains to execute complex plans. While two heads sleep, one head stays awake."],
    [86, "Seel", 0x3A, 0x15, 0x15, "mediumFast", 65, 45, 55, 45, 70, [0x39, 0x3A, 0x22, 0x9C], "The protruding horn on its head is very hard. It is used for bashing through thick ice."],
    [87, "Dewgong", 0x78, 0x15, 0x19, "mediumFast", 90, 70, 80, 70, 95, [0x39, 0x3B, 0x22, 0x9C], "Stores thermal energy in its body. Swims at a steady 8 knots even in intensely cold waters."],
    [88, "Grimer", 0x0D, 0x03, 0x03, "mediumFast", 80, 80, 50, 25, 40, [0x7C, 0x22, 0x48, 0x99], "Appears in filthy areas. Thrives by sucking up polluted sludge that is pumped out of factories."],
    [89, "Muk", 0x88, 0x03, 0x03, "mediumFast", 105, 105, 75, 50, 65, [0x7C, 0x22, 0x7E, 0x99], "Thickly covered with a filthy, vile sludge. It is so toxic, even its footprints contain poison."],
    [90, "Shellder", 0x17, 0x15, 0x15, "slow", 30, 65, 100, 40, 45, [0x39, 0x3A, 0xA1, 0x99], "Its hard shell repels any kind of attack. It is vulnerable only when its shell is open."],
    [91, "Cloyster", 0x8B, 0x15, 0x19, "slow", 50, 95, 180, 70, 85, [0x3B, 0x39, 0x99, 0xA1], "When attacked, it launches its horns in quick volleys. Its innards have never been seen."],
    [92, "Gastly", 0x19, 0x08, 0x03, "mediumSlow", 30, 35, 30, 80, 100, [0x5F, 0x55, 0x5E, 0x65], "Almost invisible, this gaseous Pokémon cloaks the target and puts it to sleep without notice."],
    [93, "Haunter", 0x93, 0x08, 0x03, "mediumSlow", 45, 50, 45, 95, 115, [0x5F, 0x55, 0x5E, 0x99], "Because of its ability to slip through block walls, it is said to be from another dimension."],
    [94, "Gengar", 0x0E, 0x08, 0x03, "mediumSlow", 60, 65, 60, 110, 130, [0x5F, 0x55, 0x5E, 0x99], "Under a full moon, this Pokémon likes to mimic the shadows of people and laugh at their fright."],
    [95, "Onix", 0x22, 0x05, 0x04, "mediumFast", 35, 45, 160, 70, 30, [0x59, 0x9D, 0x22, 0x99], "As it grows, the stone portions of its body harden to become similar to a diamond, but colored black."],
    [96, "Drowzee", 0x30, 0x18, 0x18, "mediumFast", 60, 48, 45, 42, 90, [0x5F, 0x5E, 0x56, 0x45], "Puts enemies to sleep then eats their dreams. Occasionally gets sick from eating bad dreams."],
    [97, "Hypno", 0x81, 0x18, 0x18, "mediumFast", 85, 73, 70, 67, 115, [0x5F, 0x5E, 0x56, 0x45], "When it locks eyes with an enemy, it will use a mix of PSI moves such as Hypnosis and Confusion."],
    [98, "Krabby", 0x4E, 0x15, 0x15, "mediumFast", 30, 105, 90, 50, 25, [0x98, 0x22, 0x3A, 0x0E], "Its pincers are not only powerful weapons, they are used for balance when walking sideways."],
    [99, "Kingler", 0x8A, 0x15, 0x15, "mediumFast", 55, 130, 115, 75, 50, [0x98, 0x22, 0x3F, 0x0E], "The large pincer has 10000 hp of crushing power. However, its huge size makes it unwieldy to use."],
    [100, "Voltorb", 0x06, 0x17, 0x17, "mediumFast", 40, 30, 50, 100, 55, [0x55, 0x56, 0x99, 0x81], "Usually found in power plants. Easily mistaken for a Poké Ball, they have zapped many people."],
    [101, "Electrode", 0x8D, 0x17, 0x17, "mediumFast", 60, 50, 70, 140, 80, [0x55, 0x56, 0x99, 0x3F], "It stores electric energy under very high pressure. It often explodes with little or no provocation."],
    [102, "Exeggcute", 0x0C, 0x16, 0x18, "slow", 60, 40, 80, 40, 60, [0x4F, 0x5E, 0x99, 0x48], "Often mistaken for eggs. When disturbed, they quickly gather and attack in swarms."],
    [103, "Exeggutor", 0x0A, 0x16, 0x18, "slow", 95, 95, 85, 55, 125, [0x4F, 0x5E, 0x99, 0x3F], "Legend has it that on rare occasions, one of its heads will drop off and continue on as an Exeggcute."],
    [104, "Cubone", 0x11, 0x04, 0x04, "mediumFast", 50, 50, 95, 35, 40, [0x59, 0x22, 0x3B, 0x45], "Because it never removes its skull helmet, no one has ever seen this Pokémon's real face."],
    [105, "Marowak", 0x91, 0x04, 0x04, "mediumFast", 60, 80, 110, 45, 50, [0x59, 0x22, 0x3B, 0x3F], "The bone it holds is its key weapon. It throws the bone skillfully like a boomerang to KO targets."],
    [106, "Hitmonlee", 0x2B, 0x01, 0x01, "mediumFast", 50, 120, 53, 87, 35, [0x88, 0x22, 0x26, 0x45], "When in a hurry, its legs lengthen progressively. It runs smoothly with extra long, loping strides."],
    [107, "Hitmonchan", 0x2C, 0x01, 0x01, "mediumFast", 50, 105, 79, 76, 35, [0x42, 0x08, 0x09, 0x22], "While apparently doing nothing, it fires punches in lightning fast volleys that are impossible to see."],
    [108, "Lickitung", 0x0B, 0x00, 0x00, "mediumFast", 90, 55, 75, 30, 60, [0x22, 0x59, 0x0E, 0x3B], "Its tongue can be extended like a chameleon's. It leaves a tingling sensation when it licks enemies."],
    [109, "Koffing", 0x37, 0x03, 0x03, "mediumFast", 40, 65, 95, 35, 60, [0x7C, 0x55, 0x7E, 0x99], "Because it stores several kinds of toxic gases in its body, it is prone to exploding without warning."],
    [110, "Weezing", 0x8F, 0x03, 0x03, "mediumFast", 65, 90, 120, 60, 85, [0x7C, 0x55, 0x7E, 0x99], "Where two kinds of poison gases meet, 2 Koffings can fuse into a Weezing over many years."],
    [111, "Rhyhorn", 0x12, 0x04, 0x05, "slow", 80, 85, 95, 25, 30, [0x59, 0x9D, 0x22, 0x26], "Its massive bones are 1000 times harder than human bones. It can easily knock a trailer flying."],
    [112, "Rhydon", 0x01, 0x04, 0x05, "slow", 105, 130, 120, 40, 45, [0x59, 0x9D, 0x22, 0x9C], "Protected by an armor-like hide, it is capable of living in molten lava of 3,600 degrees."],
    [113, "Chansey", 0x28, 0x00, 0x00, "fast", 250, 5, 5, 50, 105, [0x3A, 0x55, 0x87, 0x56], "A rare and elusive Pokémon that is said to bring happiness to those who manage to get it."],
    [114, "Tangela", 0x1E, 0x16, 0x16, "mediumFast", 65, 55, 115, 60, 100, [0x4F, 0x48, 0x22, 0x0E], "The whole body is swathed with wide vines that are similar to seaweed. Its vines shake as it walks."],
    [115, "Kangaskhan", 0x02, 0x00, 0x00, "mediumFast", 105, 95, 80, 90, 40, [0x22, 0x59, 0x3F, 0x39], "The infant rarely ventures out of its mother's protective pouch until it is 3 years old."],
    [116, "Horsea", 0x5C, 0x15, 0x15, "mediumFast", 30, 40, 70, 60, 70, [0x39, 0x3A, 0x61, 0x81], "Known to shoot down flying bugs with precision blasts of ink from the surface of the water."],
    [117, "Seadra", 0x5D, 0x15, 0x15, "mediumFast", 55, 65, 95, 85, 95, [0x38, 0x3B, 0x61, 0x3F], "Capable of swimming backwards by rapidly flapping its wing-like pectoral fins and stout tail."],
    [118, "Goldeen", 0x9D, 0x15, 0x15, "mediumFast", 45, 67, 60, 63, 50, [0x39, 0x7F, 0x3A, 0x26], "Its tail fin billows like an elegant ballroom dress, giving it the nickname of the Water Queen."],
    [119, "Seaking", 0x9E, 0x15, 0x15, "mediumFast", 80, 92, 65, 68, 80, [0x39, 0x3B, 0x26, 0x3F], "In the autumn spawning season, they can be seen swimming powerfully up rivers and creeks."],
    [120, "Staryu", 0x1B, 0x15, 0x15, "slow", 30, 45, 55, 85, 70, [0x39, 0x55, 0x3A, 0x69], "An enigmatic Pokémon that can effortlessly regenerate any appendage it loses in battle."],
    [121, "Starmie", 0x98, 0x15, 0x18, "slow", 60, 75, 85, 115, 100, [0x3B, 0x55, 0x5E, 0x69], "Its central core glows with the seven colors of the rainbow. Some people value the core as a gem."],
    [122, "Mr. Mime", 0x2A, 0x18, 0x18, "mediumFast", 40, 45, 65, 90, 100, [0x5E, 0x55, 0x56, 0x73], "If interrupted while it is miming, it will slap around the offender with its broad hands."],
    [123, "Scyther", 0x1A, 0x07, 0x02, "mediumFast", 70, 110, 80, 105, 55, [0xA3, 0x0E, 0x3F, 0x62], "With ninja-like agility and speed, it can create the illusion that there is more than one."],
    [124, "Jynx", 0x48, 0x19, 0x18, "mediumFast", 65, 50, 35, 95, 95, [0x8E, 0x3B, 0x5E, 0x22], "It seductively wiggles its hips as it walks. It can cause people to dance in unison with it."],
    [125, "Electabuzz", 0x35, 0x17, 0x17, "mediumFast", 65, 83, 57, 105, 85, [0x55, 0x56, 0x5E, 0x22], "Normally found near power plants, they can wander away and cause major blackouts in cities."],
    [126, "Magmar", 0x33, 0x14, 0x14, "mediumFast", 65, 95, 57, 93, 85, [0x7E, 0x22, 0x5E, 0x09], "Its body always burns with an orange glow that enables it to hide perfectly among flames."],
    [127, "Pinsir", 0x1D, 0x07, 0x07, "slow", 65, 125, 100, 85, 55, [0x0E, 0x42, 0x22, 0x3F], "If it fails to crush the victim in its pincers, it will swing it around and toss it hard."],
    [128, "Tauros", 0x3C, 0x00, 0x00, "slow", 75, 100, 95, 110, 70, [0x22, 0x3F, 0x3B, 0x59], "When it targets an enemy, it charges furiously while whipping its body with its long tails."],
    [129, "Magikarp", 0x85, 0x15, 0x15, "slow", 20, 10, 55, 80, 20, [0x96, 0x26, 0x00, 0x00], "In the distant past, it was somewhat stronger than the horribly weak descendants that exist today."],
    [130, "Gyarados", 0x16, 0x15, 0x02, "slow", 95, 125, 79, 81, 100, [0x38, 0x55, 0x3B, 0x3F], "Rarely seen in the wild. Huge and vicious, it is capable of destroying entire cities in a rage."],
    [131, "Lapras", 0x13, 0x15, 0x19, "slow", 130, 85, 80, 60, 95, [0x3B, 0x55, 0x39, 0x22], "A Pokémon that has been overhunted almost to extinction. It can ferry people across the water."],
    [132, "Ditto", 0x4C, 0x00, 0x00, "mediumFast", 48, 48, 48, 48, 48, [0x90, 0x00, 0x00, 0x00], "Capable of copying an enemy's genetic code to instantly transform itself into a duplicate of the enemy."],
    [133, "Eevee", 0x66, 0x00, 0x00, "mediumFast", 55, 55, 50, 55, 65, [0x22, 0x26, 0x62, 0x73], "Its genetic code is irregular. It may mutate if it is exposed to radiation from element stones."],
    [134, "Vaporeon", 0x69, 0x15, 0x15, "mediumFast", 130, 65, 60, 65, 110, [0x39, 0x3B, 0x22, 0x9C], "Lives close to water. Its long tail is ridged with a fin which is often mistaken for a mermaid's."],
    [135, "Jolteon", 0x68, 0x17, 0x17, "mediumFast", 65, 65, 60, 130, 110, [0x55, 0x56, 0x2A, 0x26], "It accumulates negative ions in the atmosphere to blast out 10000-volt lightning bolts."],
    [136, "Flareon", 0x67, 0x14, 0x14, "mediumFast", 65, 130, 60, 65, 110, [0x7E, 0x22, 0x3F, 0x62], "When storing thermal energy in its body, its temperature could soar to over 1600 degrees."],
    [137, "Porygon", 0xAA, 0x00, 0x00, "mediumFast", 65, 60, 70, 40, 75, [0x3B, 0x55, 0x69, 0x56], "A Pokémon that consists entirely of programming code. Capable of moving freely in cyberspace."],
    [138, "Omanyte", 0x62, 0x05, 0x15, "mediumFast", 35, 40, 100, 35, 90, [0x39, 0x3A, 0x22, 0x9C], "Although long extinct, in rare cases, it can be genetically resurrected from fossils."],
    [139, "Omastar", 0x63, 0x05, 0x15, "mediumFast", 70, 60, 125, 55, 115, [0x38, 0x3B, 0x22, 0x45], "A prehistoric Pokémon that died out when its heavy shell made it impossible to catch prey."],
    [140, "Kabuto", 0x5A, 0x05, 0x15, "mediumFast", 30, 80, 90, 55, 45, [0x39, 0xA3, 0x22, 0x3A], "A Pokémon that was resurrected from a fossil found in what was once the ocean floor eons ago."],
    [141, "Kabutops", 0x5B, 0x05, 0x15, "mediumFast", 60, 115, 105, 80, 70, [0x0E, 0xA3, 0x39, 0x3F], "Its sleek shape is perfect for swimming. It slashes prey with its claws and drains the body fluids."],
    [142, "Aerodactyl", 0xAB, 0x05, 0x02, "slow", 80, 105, 65, 130, 60, [0x8F, 0x26, 0x7E, 0x3F], "A ferocious, prehistoric Pokémon that goes for the enemy's throat with its serrated saw-like fangs."],
    [143, "Snorlax", 0x84, 0x00, 0x00, "slow", 160, 110, 65, 30, 65, [0x22, 0x59, 0x3F, 0x9C], "Very lazy. Just eats and sleeps. As its rotund bulk builds, it becomes steadily more slothful."],
    [144, "Articuno", 0x4A, 0x19, 0x02, "slow", 90, 85, 100, 85, 125, [0x3B, 0x3A, 0x3F, 0x61], "A legendary bird Pokémon that is said to appear to doomed people who are lost in icy mountains."],
    [145, "Zapdos", 0x4B, 0x17, 0x02, "slow", 90, 90, 85, 100, 125, [0x55, 0x41, 0x56, 0x61], "A legendary bird Pokémon that is said to appear from clouds while dropping enormous lightning bolts."],
    [146, "Moltres", 0x49, 0x14, 0x02, "slow", 90, 100, 90, 90, 125, [0x7E, 0x8F, 0x61, 0x3F], "Known as the legendary bird of fire. Every flap of its wings creates a dazzling flash of flames."],
    [147, "Dratini", 0x58, 0x1A, 0x1A, "slow", 41, 64, 45, 50, 50, [0x56, 0x3B, 0x55, 0x22], "Long considered a mythical Pokémon until recently when a small colony was found living underwater."],
    [148, "Dragonair", 0x59, 0x1A, 0x1A, "slow", 61, 84, 65, 70, 70, [0x56, 0x3B, 0x55, 0x3F], "A mystical Pokémon that exudes a gentle aura. Has the ability to change climate conditions."],
    [149, "Dragonite", 0x42, 0x1A, 0x02, "slow", 91, 134, 95, 80, 100, [0x3B, 0x22, 0x3F, 0x56], "An extremely rarely seen marine Pokémon. Its intelligence is said to match that of humans."],
    [150, "Mewtwo", 0x83, 0x18, 0x18, "slow", 106, 110, 90, 130, 154, [0x85, 0x5E, 0x3B, 0x69], "It was created by a scientist after years of horrific gene splicing and DNA engineering experiments."],
    [151, "Mew", 0x15, 0x18, 0x18, "mediumSlow", 100, 100, 100, 100, 100, [0x0E, 0x59, 0x22, 0x87], "So rare that it is still said to be a mirage by many experts. Only a few people have seen it worldwide."]
  ];

  const SPECIES_LIST = RAW_151.map(function (row) {
    const name = row[1];
    const upper = name.toUpperCase();
    const slug = name
      .toLowerCase()
      .replace("♀", "-f")
      .replace("♂", "-m")
      .replace(/[^a-z0-9-]/g, "");
    return {
      dex: row[0],
      key: slug,
      name: name,
      upperName: upper.slice(0, 10),
      id: row[2],
      type1: row[3],
      type2: row[4],
      expGroup: row[5],
      base: { hp: row[6], atk: row[7], def: row[8], spd: row[9], spc: row[10] },
      defaultMoves: row[11],
      flavor: row[12]
    };
  });

  const SPECIES_BY_ID = new Map();
  const SPECIES_BY_DEX = new Map();
  SPECIES_LIST.forEach(function (sp) {
    SPECIES_BY_ID.set(sp.id, sp);
    SPECIES_BY_DEX.set(sp.dex, sp);
  });

  const MOVES_BY_ID = new Map();
  MOVES_LIST.forEach(function (mv) {
    MOVES_BY_ID.set(mv.id, mv);
  });

  function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isNaN(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
  }

  function toHex(value, padDigits) {
    return "0x" + (value >>> 0).toString(16).toUpperCase().padStart(padDigits, "0");
  }

  function formatBytesHex(uint8Slice) {
    const parts = [];
    for (let i = 0; i < uint8Slice.length; i++) {
      parts.push(uint8Slice[i].toString(16).toUpperCase().padStart(2, "0"));
    }
    return parts.join(" ");
  }

  function encodeGen1Char(ch) {
    if (ch === "♀") return 0xF5;
    if (ch === "♂") return 0xEF;
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) return 0x80 + (code - 65);
    if (code >= 97 && code <= 122) return 0xA0 + (code - 97);
    if (code >= 48 && code <= 57) return 0xF6 + (code - 48);
    if (ch === " ") return 0x7F;
    if (ch === "-") return 0xE3;
    if (ch === ".") return 0xE8;
    if (ch === "'") return 0xE0;
    return 0x7F;
  }

  function encodeGen1StringBlock(text, blockLength) {
    const out = new Uint8Array(blockLength);
    out.fill(0x50);
    const clean = String(text || "").toUpperCase().slice(0, blockLength - 1);
    for (let i = 0; i < clean.length; i++) {
      out[i] = encodeGen1Char(clean[i]);
    }
    out[clean.length] = 0x50;
    return out;
  }

  function decodeGen1String(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x50 || b === 0x00) break;
      if (b >= 0x80 && b <= 0x99) out += String.fromCharCode(65 + (b - 0x80));
      else if (b >= 0xA0 && b <= 0xB9) out += String.fromCharCode(97 + (b - 0xA0));
      else if (b >= 0xF6 && b <= 0xFF) out += String.fromCharCode(48 + (b - 0xF6));
      else if (b === 0xF5) out += "♀";
      else if (b === 0xEF) out += "♂";
      else if (b === 0x7F) out += " ";
      else if (b === 0xE3) out += "-";
      else if (b === 0xE8) out += ".";
      else if (b === 0xE0) out += "'";
      else out += "?";
    }
    return out;
  }

  function deriveHpDv(dvs) {
    return ((dvs.atk & 1) << 3) | ((dvs.def & 1) << 2) | ((dvs.spd & 1) << 1) | (dvs.spc & 1);
  }

  function packDvBytes(dvs) {
    return [
      ((dvs.atk & 0x0F) << 4) | (dvs.def & 0x0F),
      ((dvs.spd & 0x0F) << 4) | (dvs.spc & 0x0F)
    ];
  }

  function calcStatExpTerm(statExp) {
    const bounded = clampInt(statExp, 0, 65535, 65535);
    const sqrtCeil = Math.min(255, Math.ceil(Math.sqrt(bounded)));
    return Math.floor(sqrtCeil / 4);
  }

  function calculateGen1Stats(species, level, dvs, statExp) {
    const lvl = clampInt(level, 1, 100, 100);
    const hpDv = deriveHpDv(dvs);
    const hpEv = calcStatExpTerm(statExp.hp);
    const atkEv = calcStatExpTerm(statExp.atk);
    const defEv = calcStatExpTerm(statExp.def);
    const spdEv = calcStatExpTerm(statExp.spd);
    const spcEv = calcStatExpTerm(statExp.spc);

    return {
      hp: Math.floor((((species.base.hp + hpDv) * 2 + hpEv) * lvl) / 100) + lvl + 10,
      atk: Math.floor((((species.base.atk + (dvs.atk & 0x0F)) * 2 + atkEv) * lvl) / 100) + 5,
      def: Math.floor((((species.base.def + (dvs.def & 0x0F)) * 2 + defEv) * lvl) / 100) + 5,
      spd: Math.floor((((species.base.spd + (dvs.spd & 0x0F)) * 2 + spdEv) * lvl) / 100) + 5,
      spc: Math.floor((((species.base.spc + (dvs.spc & 0x0F)) * 2 + spcEv) * lvl) / 100) + 5,
      hpDv: hpDv
    };
  }

  function calculateGen1Experience(expGroup, level) {
    const n = clampInt(level, 1, 100, 100);
    if (n <= 1) return 0;
    if (expGroup === "fast") return Math.floor((4 * n * n * n) / 5);
    if (expGroup === "mediumFast") return n * n * n;
    if (expGroup === "mediumSlow") {
      return Math.max(0, Math.floor((6 * n * n * n) / 5) - 15 * n * n + 100 * n - 140);
    }
    return Math.floor((5 * n * n * n) / 4);
  }

  function computeRangeChecksum(bytes, startOffset, endOffsetInclusive) {
    let checksum = 0xFF;
    for (let offset = startOffset; offset <= endOffsetInclusive; offset++) {
      checksum = (checksum - bytes[offset]) & 0xFF;
    }
    return checksum;
  }

  function computeGen1Checksum(bytes) {
    return computeRangeChecksum(bytes, 0x2598, 0x3522);
  }

  function sanitizeTrainerName(rawName) {
    const stripped = String(rawName || "")
      .toUpperCase()
      .replace(/[^A-Z0-9 .'-]/g, "")
      .slice(0, 7);
    return stripped.length > 0 ? stripped : "PLAYER";
  }

  function partitionRosterIntoPartyAndBoxes(rosterList) {
    const party = [];
    const boxes = [];
    for (let b = 0; b < 12; b++) {
      boxes.push([]);
    }

    const overflowToBox = [];
    rosterList.forEach(function (mon) {
      if (!mon || mon.enabled === false) return;
      if (mon.inParty && party.length < 6) {
        party.push(mon);
      } else {
        overflowToBox.push(mon);
      }
    });

    const unplaced = [];
    overflowToBox.forEach(function (mon) {
      const requestedBox = clampInt(mon.boxNum, 0, 12, 0);
      if (requestedBox >= 1 && requestedBox <= 12 && boxes[requestedBox - 1].length < 20) {
        boxes[requestedBox - 1].push(mon);
      } else {
        unplaced.push(mon);
      }
    });

    unplaced.forEach(function (mon) {
      for (let b = 0; b < 12; b++) {
        if (boxes[b].length < 20) {
          boxes[b].push(mon);
          break;
        }
      }
    });

    if (party.length === 0) {
      for (let b = 0; b < 12; b++) {
        if (boxes[b].length > 0) {
          party.push(boxes[b].shift());
          break;
        }
      }
    }

    let boxTotal = 0;
    for (let b = 0; b < 12; b++) {
      boxTotal += boxes[b].length;
    }

    return {
      party: party,
      boxes: boxes,
      boxTotal: boxTotal
    };
  }

  function writePokemonCore33Bytes(view, structOffset, member, trainerId) {
    const species = SPECIES_BY_ID.get(member.speciesId) || SPECIES_LIST[0];
    const level = clampInt(member.level, 1, 100, 100);
    const dvs = {
      atk: clampInt(member.dvs && member.dvs.atk, 0, 15, 15),
      def: clampInt(member.dvs && member.dvs.def, 0, 15, 15),
      spd: clampInt(member.dvs && member.dvs.spd, 0, 15, 15),
      spc: clampInt(member.dvs && member.dvs.spc, 0, 15, 15)
    };
    const statExp = {
      hp: clampInt(member.statExp && member.statExp.hp, 0, 65535, 0xFFFF),
      atk: clampInt(member.statExp && member.statExp.atk, 0, 65535, 0xFFFF),
      def: clampInt(member.statExp && member.statExp.def, 0, 65535, 0xFFFF),
      spd: clampInt(member.statExp && member.statExp.spd, 0, 65535, 0xFFFF),
      spc: clampInt(member.statExp && member.statExp.spc, 0, 65535, 0xFFFF)
    };

    const stats = calculateGen1Stats(species, level, dvs, statExp);
    const exp = calculateGen1Experience(species.expGroup, level);
    const packedDvs = packDvBytes(dvs);

    const rawMoves = Array.isArray(member.moves) ? member.moves.slice(0, 4) : species.defaultMoves.slice(0, 4);
    while (rawMoves.length < 4) rawMoves.push(0x00);
    const hasValidMove = rawMoves.some(function (m) {
      return m > 0 && MOVES_BY_ID.has(m);
    });
    if (!hasValidMove) rawMoves[0] = species.defaultMoves[0];

    view.setUint8(structOffset + 0, species.id);
    view.setUint16(structOffset + 1, stats.hp, false);
    view.setUint8(structOffset + 3, level);
    view.setUint8(structOffset + 4, 0x00);
    view.setUint8(structOffset + 5, species.type1);
    view.setUint8(structOffset + 6, species.type2);
    view.setUint8(structOffset + 7, 0x00);

    for (let mIdx = 0; mIdx < 4; mIdx++) {
      const moveId = MOVES_BY_ID.has(rawMoves[mIdx]) ? rawMoves[mIdx] : 0x00;
      view.setUint8(structOffset + 8 + mIdx, moveId);
      const moveObj = MOVES_BY_ID.get(moveId);
      const ppVal = moveId === 0x00 || !moveObj ? 0x00 : Math.min(0x28, moveObj.pp);
      view.setUint8(structOffset + 29 + mIdx, ppVal);
    }

    view.setUint16(structOffset + 12, trainerId, false);
    view.setUint8(structOffset + 14, (exp >>> 16) & 0xFF);
    view.setUint8(structOffset + 15, (exp >>> 8) & 0xFF);
    view.setUint8(structOffset + 16, exp & 0xFF);

    view.setUint16(structOffset + 17, statExp.hp, false);
    view.setUint16(structOffset + 19, statExp.atk, false);
    view.setUint16(structOffset + 21, statExp.def, false);
    view.setUint16(structOffset + 23, statExp.spd, false);
    view.setUint16(structOffset + 25, statExp.spc, false);

    view.setUint8(structOffset + 27, packedDvs[0]);
    view.setUint8(structOffset + 28, packedDvs[1]);

    return { species: species, level: level, stats: stats };
  }

  function writeSinglePcBox(bytes, view, boxBaseOffset, boxMembers, trainerName, trainerId) {
    const count = Math.min(20, boxMembers.length);
    view.setUint8(boxBaseOffset + 0x000, count);
    for (let i = 0; i < count; i++) {
      const sp = SPECIES_BY_ID.get(boxMembers[i].speciesId) || SPECIES_LIST[0];
      view.setUint8(boxBaseOffset + 0x001 + i, sp.id);
    }
    view.setUint8(boxBaseOffset + 0x001 + count, 0xFF);

    const otBlock = encodeGen1StringBlock(trainerName, 11);
    for (let i = 0; i < count; i++) {
      const member = boxMembers[i];
      const res = writePokemonCore33Bytes(view, boxBaseOffset + 0x016 + i * 33, member, trainerId);
      bytes.set(otBlock, boxBaseOffset + 0x2AA + i * 11);
      const nickBlock = encodeGen1StringBlock(member.nickname || res.species.upperName, 11);
      bytes.set(nickBlock, boxBaseOffset + 0x386 + i * 11);
    }
  }

  function buildGen1SaveBuffer(config) {
    let activeParty = [];
    let boxes = [];
    let boxTotalCount = 0;

    if (Array.isArray(config.roster)) {
      const part = partitionRosterIntoPartyAndBoxes(config.roster);
      activeParty = part.party;
      boxes = part.boxes;
      boxTotalCount = part.boxTotal;
    } else {
      activeParty = (config.party || []).filter(function (slot) {
        return slot && slot.enabled !== false;
      });
      const flatBox = (config.boxPokemon || []).slice(0, 240);
      for (let b = 0; b < 12; b++) {
        const slice = flatBox.slice(b * 20, (b + 1) * 20);
        boxes.push(slice);
        boxTotalCount += slice.length;
      }
    }

    if (activeParty.length < 1 || activeParty.length > 6) {
      throw new Error("Party must contain between 1 and 6 active Pokémon.");
    }

    const buffer = new ArrayBuffer(32768);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    bytes.fill(0x00);

    const trainerName = sanitizeTrainerName(config.trainerName);
    const trainerId = clampInt(config.trainerId, 0, 65535, 4919);
    const offsetMode = config.offsetMode === "spec" ? "spec" : "retail";
    const writePcBoxes = offsetMode === "retail" || boxTotalCount > 0;

    view.setUint8(0x2602, 0x00);
    const trainerNameBlock = encodeGen1StringBlock(trainerName, 11);
    bytes.set(trainerNameBlock, 0x2598);

    if (offsetMode === "retail") {
      const allMons = activeParty.slice();
      for (let b = 0; b < 12; b++) {
        for (let j = 0; j < boxes[b].length; j++) {
          allMons.push(boxes[b][j]);
        }
      }
      allMons.forEach(function (m) {
        const sp = SPECIES_BY_ID.get(m.speciesId);
        if (!sp) return;
        const bitIdx = sp.dex - 1;
        bytes[0x25A3 + (bitIdx >> 3)] |= 1 << (bitIdx & 7);
        bytes[0x25B6 + (bitIdx >> 3)] |= 1 << (bitIdx & 7);
      });
    }

    view.setUint8(0x2F2C, activeParty.length);
    for (let i = 0; i < activeParty.length; i++) {
      const sp = SPECIES_BY_ID.get(activeParty[i].speciesId) || SPECIES_LIST[0];
      view.setUint8(0x2F2D + i, sp.id);
    }
    view.setUint8(0x2F2D + activeParty.length, 0xFF);

    const otBaseOffset = offsetMode === "retail" ? 0x303C : 0x302A;
    const nickBaseOffset = offsetMode === "retail" ? 0x307E : 0x306C;

    for (let i = 0; i < activeParty.length; i++) {
      const member = activeParty[i];
      const structOffset = 0x2F34 + i * 44;
      const res = writePokemonCore33Bytes(view, structOffset, member, trainerId);
      view.setUint8(structOffset + 33, res.level);
      view.setUint16(structOffset + 34, res.stats.hp, false);
      view.setUint16(structOffset + 36, res.stats.atk, false);
      view.setUint16(structOffset + 38, res.stats.def, false);
      view.setUint16(structOffset + 40, res.stats.spd, false);
      view.setUint16(structOffset + 42, res.stats.spc, false);
    }

    for (let i = 0; i < activeParty.length; i++) {
      const member = activeParty[i];
      const sp = SPECIES_BY_ID.get(member.speciesId) || SPECIES_LIST[0];
      bytes.set(trainerNameBlock, otBaseOffset + i * 11);
      bytes.set(encodeGen1StringBlock(member.nickname || sp.upperName, 11), nickBaseOffset + i * 11);
    }

    if (writePcBoxes) {
      view.setUint8(0x284C, 0x80);
      writeSinglePcBox(bytes, view, 0x30C0, boxes[0], trainerName, trainerId);

      for (let b = 0; b < 6; b++) {
        const boxAddr = 0x4000 + b * 0x462;
        writeSinglePcBox(bytes, view, boxAddr, boxes[b], trainerName, trainerId);
        view.setUint8(0x5A4D + b, computeRangeChecksum(bytes, boxAddr, boxAddr + 0x461));
      }
      view.setUint8(0x5A4C, computeRangeChecksum(bytes, 0x4000, 0x5A4B));

      for (let b = 0; b < 6; b++) {
        const boxAddr = 0x6000 + b * 0x462;
        writeSinglePcBox(bytes, view, boxAddr, boxes[6 + b], trainerName, trainerId);
        view.setUint8(0x7A4D + b, computeRangeChecksum(bytes, boxAddr, boxAddr + 0x461));
      }
      view.setUint8(0x7A4C, computeRangeChecksum(bytes, 0x6000, 0x7A4B));
    }

    const checksum = computeGen1Checksum(bytes);
    view.setUint8(0x3523, checksum);

    return {
      buffer: buffer,
      bytes: bytes,
      checksum: checksum,
      bank2Checksum: bytes[0x5A4C],
      bank3Checksum: bytes[0x7A4C],
      activeCount: activeParty.length,
      boxCount: boxTotalCount,
      totalCount: activeParty.length + boxTotalCount,
      otBaseOffset: otBaseOffset,
      nickBaseOffset: nickBaseOffset
    };
  }

  function parseMemberFromStruct(bytes, view, structOffset) {
    const spId = bytes[structOffset + 0];
    const sp = SPECIES_BY_ID.get(spId) || SPECIES_LIST[0];
    const level = clampInt(bytes[structOffset + 3], 1, 100, 100);
    const b27 = bytes[structOffset + 27];
    const b28 = bytes[structOffset + 28];
    return {
      speciesId: sp.id,
      level: level,
      moves: [
        bytes[structOffset + 8],
        bytes[structOffset + 9],
        bytes[structOffset + 10],
        bytes[structOffset + 11]
      ],
      dvs: {
        atk: (b27 >>> 4) & 0x0F,
        def: b27 & 0x0F,
        spd: (b28 >>> 4) & 0x0F,
        spc: b28 & 0x0F
      },
      statExp: {
        hp: view.getUint16(structOffset + 17, false),
        atk: view.getUint16(structOffset + 19, false),
        def: view.getUint16(structOffset + 21, false),
        spd: view.getUint16(structOffset + 23, false),
        spc: view.getUint16(structOffset + 25, false)
      }
    };
  }

  function inspectSaveBytes(uint8) {
    if (!uint8 || uint8.byteLength !== 32768) {
      throw new Error("Invalid file size: expected exactly 32,768 bytes (32KB).");
    }
    const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    const storedChecksum = uint8[0x3523];
    const computedChecksum = computeGen1Checksum(uint8);
    const partyCount = Math.min(6, uint8[0x2F2C]);
    const trainer = decodeGen1String(uint8.subarray(0x2598, 0x25A3));
    const speciesNames = [];
    const importedRoster = [];

    for (let i = 0; i < partyCount; i++) {
      const spId = uint8[0x2F2D + i];
      const sp = SPECIES_BY_ID.get(spId);
      speciesNames.push(sp ? sp.name : toHex(spId, 2));
      const parsed = parseMemberFromStruct(uint8, view, 0x2F34 + i * 44);
      parsed.inParty = true;
      parsed.boxNum = 0;
      importedRoster.push(parsed);
    }

    let boxTotal = 0;
    const boxesInitialized = (uint8[0x284C] & 0x80) !== 0;
    if (boxesInitialized) {
      for (let b = 0; b < 12; b++) {
        const base = b < 6 ? 0x4000 + b * 0x462 : 0x6000 + (b - 6) * 0x462;
        const c = Math.min(20, uint8[base]);
        if (uint8[base + 1 + c] === 0xFF) {
          boxTotal += c;
          for (let j = 0; j < c; j++) {
            const parsed = parseMemberFromStruct(uint8, view, base + 0x016 + j * 33);
            parsed.inParty = false;
            parsed.boxNum = b + 1;
            importedRoster.push(parsed);
          }
        }
      }
    }

    return {
      validChecksum: storedChecksum === computedChecksum,
      storedChecksum: storedChecksum,
      computedChecksum: computedChecksum,
      partyCount: partyCount,
      boxCount: boxTotal,
      totalCount: partyCount + boxTotal,
      trainerName: trainer || "PLAYER",
      speciesNames: speciesNames,
      importedRoster: importedRoster
    };
  }

  globalThis.Gen1SaveEngine = {
    SPECIES_LIST: SPECIES_LIST,
    MOVES_LIST: MOVES_LIST,
    encodeGen1Char: encodeGen1Char,
    encodeGen1StringBlock: encodeGen1StringBlock,
    decodeGen1String: decodeGen1String,
    deriveHpDv: deriveHpDv,
    packDvBytes: packDvBytes,
    calculateGen1Stats: calculateGen1Stats,
    calculateGen1Experience: calculateGen1Experience,
    computeRangeChecksum: computeRangeChecksum,
    computeGen1Checksum: computeGen1Checksum,
    buildGen1SaveBuffer: buildGen1SaveBuffer,
    inspectSaveBytes: inspectSaveBytes
  };

  if (typeof document === "undefined") {
    return;
  }

  const STORAGE_KEY = "pkmn_sram_studio_v3";
  const SUBTABS = ["stats", "moves", "dvs", "art"];
  let nextUidCounter = 1;

  function allocUid() {
    return "mon_" + String(nextUidCounter++);
  }

  function createMonFromDex(dexNum, inParty, levelOverride, customMoves, explicitBoxNum) {
    const sp = SPECIES_BY_DEX.get(dexNum) || SPECIES_LIST[0];
    return {
      uid: allocUid(),
      enabled: true,
      inParty: Boolean(inParty),
      boxNum: inParty ? 0 : clampInt(explicitBoxNum, 1, 12, 1),
      speciesId: sp.id,
      nickname: "",
      level: clampInt(levelOverride, 1, 100, 100),
      moves: Array.isArray(customMoves) ? customMoves.slice(0, 4) : sp.defaultMoves.slice(0, 4),
      dvs: { atk: 15, def: 15, spd: 15, spc: 15 },
      statExp: { hp: 0xFFFF, atk: 0xFFFF, def: 0xFFFF, spd: 0xFFFF, spc: 0xFFFF }
    };
  }

  function createKids30Roster() {
    const partyDex = [7, 6, 3, 25, 150, 149];
    const boxDex = [
      9, 151, 94, 65, 143, 130, 131, 133, 134, 135,
      136, 59, 68, 144, 145, 146, 142, 128, 112, 103,
      121, 34, 38, 106
    ];
    const out = [];
    partyDex.forEach(function (d) {
      out.push(createMonFromDex(d, true, 100, null, 0));
    });
    boxDex.forEach(function (d, idx) {
      out.push(createMonFromDex(d, false, 100, null, Math.floor(idx / 20) + 1));
    });
    return out;
  }

  function createAll151Roster() {
    const priorityParty = [25, 6, 9, 3, 150, 151];
    const partySet = new Set(priorityParty);
    const out = [];
    priorityParty.forEach(function (d) {
      out.push(createMonFromDex(d, true, 100, null, 0));
    });
    let boxIdx = 0;
    for (let d = 1; d <= 151; d++) {
      if (!partySet.has(d)) {
        out.push(createMonFromDex(d, false, 100, null, Math.floor(boxIdx / 20) + 1));
        boxIdx++;
      }
    }
    return out;
  }

  function createCompetitive6Roster() {
    return [
      createMonFromDex(128, true, 100, [0x22, 0x3F, 0x3B, 0x59], 0),
      createMonFromDex(113, true, 100, [0x3A, 0x55, 0x87, 0x56], 0),
      createMonFromDex(143, true, 100, [0x22, 0x59, 0x3F, 0x99], 0),
      createMonFromDex(103, true, 100, [0x4F, 0x5E, 0x99, 0x48], 0),
      createMonFromDex(121, true, 100, [0x3B, 0x55, 0x69, 0x56], 0),
      createMonFromDex(65, true, 100, [0x5E, 0x45, 0x69, 0x56], 0)
    ];
  }

  const state = {
    activeTab: "pokedex",
    activeSubTab: "stats",
    artStyle: "artwork",
    trainerName: "PLAYER",
    trainerId: 4919,
    fileName: "POKEMON.sav",
    offsetMode: "retail",
    rosterSearch: "",
    rosterFilter: "all",
    rosterSort: "slot",
    boxesViewFilter: "all",
    roster: createKids30Roster(),
    selectedUid: "",
    lastNotice: null
  };

  function normalizeRosterLocations() {
    if (!Array.isArray(state.roster) || state.roster.length === 0) {
      state.roster = createKids30Roster();
    }
    if (state.roster.length > 246) {
      state.roster = state.roster.slice(0, 246);
    }
    state.roster.forEach(function (mon) {
      if (!mon.uid) mon.uid = allocUid();
    });

    const part = partitionRosterIntoPartyAndBoxes(state.roster);
    const canonical = [];
    part.party.forEach(function (mon) {
      mon.inParty = true;
      mon.boxNum = 0;
      canonical.push(mon);
    });
    for (let b = 0; b < 12; b++) {
      part.boxes[b].forEach(function (mon) {
        mon.inParty = false;
        mon.boxNum = b + 1;
        canonical.push(mon);
      });
    }
    state.roster = canonical;

    const exists = state.roster.some(function (m) {
      return m.uid === state.selectedUid;
    });
    if (!exists && state.roster.length > 0) {
      state.selectedUid = state.roster[0].uid;
    }
  }

  function computeSlotMap() {
    normalizeRosterLocations();
    const part = partitionRosterIntoPartyAndBoxes(state.roster);
    const map = new Map();
    let orderRank = 0;

    part.party.forEach(function (mon, idx) {
      const slot = idx + 1;
      orderRank++;
      map.set(mon.uid, {
        kind: "party",
        groupKey: "party",
        partySlot: slot,
        boxNum: 0,
        boxSlot: 0,
        slotInGroup: slot,
        groupSize: part.party.length,
        orderRank: orderRank,
        shortLabel: "PARTY #" + String(slot).padStart(2, "0"),
        detailLabel: "Party #" + String(slot)
      });
    });

    for (let b = 0; b < 12; b++) {
      const list = part.boxes[b];
      list.forEach(function (mon, idx) {
        const slot = idx + 1;
        orderRank++;
        map.set(mon.uid, {
          kind: "box",
          groupKey: "box-" + String(b + 1),
          partySlot: 0,
          boxNum: b + 1,
          boxSlot: slot,
          slotInGroup: slot,
          groupSize: list.length,
          orderRank: orderRank,
          shortLabel: "BOX " + String(b + 1) + " · #" + String(slot).padStart(2, "0"),
          detailLabel: "Box " + String(b + 1) + " Slot " + String(slot)
        });
      });
    }

    return {
      map: map,
      party: part.party,
      boxes: part.boxes,
      partyCount: part.party.length,
      boxCount: part.boxTotal
    };
  }

  function rebuildRosterFromGroups(party, boxes) {
    const next = [];
    party.forEach(function (m) {
      m.inParty = true;
      m.boxNum = 0;
      next.push(m);
    });
    for (let b = 0; b < 12; b++) {
      boxes[b].forEach(function (m) {
        m.inParty = false;
        m.boxNum = b + 1;
        next.push(m);
      });
    }
    state.roster = next;
  }

  function movePokemonToGroupAndSlot(uid, targetGroupKey, targetOneBasedSlot) {
    const slotData = computeSlotMap();
    const currentInfo = slotData.map.get(uid);
    if (!currentInfo) return;

    const party = slotData.party.slice();
    const boxes = slotData.boxes.map(function (arr) {
      return arr.slice();
    });

    function getGroupArray(key) {
      if (key === "party") return party;
      if (key.startsWith("box-")) {
        const bNum = clampInt(key.slice(4), 1, 12, 1);
        return boxes[bNum - 1];
      }
      return party;
    }

    const srcArr = getGroupArray(currentInfo.groupKey);
    const dstArr = getGroupArray(targetGroupKey);
    const srcIdx = srcArr.findIndex(function (m) {
      return m.uid === uid;
    });
    if (srcIdx === -1) return;

    const mon = srcArr[srcIdx];
    const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];

    if (currentInfo.groupKey === targetGroupKey) {
      srcArr.splice(srcIdx, 1);
      const boundedIdx = clampInt(targetOneBasedSlot, 1, srcArr.length + 1, srcIdx + 1) - 1;
      srcArr.splice(boundedIdx, 0, mon);
      rebuildRosterFromGroups(party, boxes);
      persistState();
      renderAll();
      showBanner(
        "Moved " + sp.name + " to " + (targetGroupKey === "party" ? "Party #" : "Box " + targetGroupKey.slice(4) + " #") + String(boundedIdx + 1) + ".",
        "SLOT REORDERED",
        false
      );
      return;
    }

    if (currentInfo.groupKey === "party" && party.length <= 1) {
      showBanner("At least 1 Pokémon must remain in Active Party.", "MIN 1 IN PARTY", true);
      renderDetailSubPane();
      return;
    }

    const maxCap = targetGroupKey === "party" ? 6 : 20;
    srcArr.splice(srcIdx, 1);

    if (dstArr.length >= maxCap) {
      const swapIdx = clampInt(targetOneBasedSlot, 1, maxCap, maxCap) - 1;
      const displaced = dstArr[swapIdx];
      dstArr[swapIdx] = mon;
      srcArr.splice(Math.min(srcIdx, srcArr.length), 0, displaced);
      rebuildRosterFromGroups(party, boxes);
      persistState();
      renderAll();
      const dispSp = SPECIES_BY_ID.get(displaced.speciesId) || SPECIES_LIST[0];
      showBanner(
        "Swapped " + sp.name + " with " + dispSp.name + ".",
        "SLOTS SWAPPED",
        false
      );
      return;
    }

    const insertIdx = clampInt(targetOneBasedSlot, 1, dstArr.length + 1, dstArr.length + 1) - 1;
    dstArr.splice(insertIdx, 0, mon);
    rebuildRosterFromGroups(party, boxes);
    persistState();
    renderAll();
    const destLabel =
      targetGroupKey === "party"
        ? "Party #" + String(insertIdx + 1)
        : "Box " + targetGroupKey.slice(4) + " #" + String(insertIdx + 1);
    showBanner("Moved " + sp.name + " to " + destLabel + ".", "LOCATION UPDATED", false);
  }

  function loadSavedState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem("pkmn_sram_studio_v2");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.trainerName === "string") state.trainerName = parsed.trainerName.slice(0, 7);
      if (typeof parsed.trainerId === "number") state.trainerId = clampInt(parsed.trainerId, 0, 65535, 4919);
      if (typeof parsed.fileName === "string" && parsed.fileName.trim()) state.fileName = parsed.fileName.trim();
      if (parsed.offsetMode === "spec" || parsed.offsetMode === "retail") state.offsetMode = parsed.offsetMode;
      if (parsed.artStyle === "sprite" || parsed.artStyle === "artwork") state.artStyle = parsed.artStyle;
      if (parsed.rosterSort === "slot" || parsed.rosterSort === "dex" || parsed.rosterSort === "name") {
        state.rosterSort = parsed.rosterSort;
      }
      if (Array.isArray(parsed.roster) && parsed.roster.length > 0) {
        state.roster = parsed.roster.slice(0, 246).map(function (item) {
          const sp = SPECIES_BY_ID.get(item && item.speciesId) || SPECIES_LIST[0];
          const inParty = Boolean(item && item.inParty);
          return {
            uid: allocUid(),
            enabled: true,
            inParty: inParty,
            boxNum: inParty ? 0 : clampInt(item && item.boxNum, 0, 12, 0),
            speciesId: sp.id,
            nickname: typeof (item && item.nickname) === "string" ? item.nickname.slice(0, 10) : "",
            level: clampInt(item && item.level, 1, 100, 100),
            moves: Array.isArray(item && item.moves) ? item.moves.slice(0, 4) : sp.defaultMoves.slice(0, 4),
            dvs: {
              atk: clampInt(item && item.dvs && item.dvs.atk, 0, 15, 15),
              def: clampInt(item && item.dvs && item.dvs.def, 0, 15, 15),
              spd: clampInt(item && item.dvs && item.dvs.spd, 0, 15, 15),
              spc: clampInt(item && item.dvs && item.dvs.spc, 0, 15, 15)
            },
            statExp: {
              hp: clampInt(item && item.statExp && item.statExp.hp, 0, 65535, 0xFFFF),
              atk: clampInt(item && item.statExp && item.statExp.atk, 0, 65535, 0xFFFF),
              def: clampInt(item && item.statExp && item.statExp.def, 0, 65535, 0xFFFF),
              spd: clampInt(item && item.statExp && item.statExp.spd, 0, 65535, 0xFFFF),
              spc: clampInt(item && item.statExp && item.statExp.spc, 0, 65535, 0xFFFF)
            }
          };
        });
      }
    } catch (_err) {
      state.roster = createKids30Roster();
    }
  }

  function persistState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          trainerName: state.trainerName,
          trainerId: state.trainerId,
          fileName: state.fileName,
          offsetMode: state.offsetMode,
          artStyle: state.artStyle,
          rosterSort: state.rosterSort,
          roster: state.roster
        })
      );
    } catch (_err) {
      return;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getSpriteUrl(dex, artStyle) {
    if (artStyle === "sprite") {
      return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/yellow/transparent/" + String(dex) + ".png";
    }
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/" + String(dex) + ".png";
  }

  function getArtOfPkmUrl(sp) {
    if (sp.dex === 29) return "https://www.artofpkm.com/pokemon/nidoran_f";
    if (sp.dex === 32) return "https://www.artofpkm.com/pokemon/nidoran_m";
    if (sp.dex === 83) return "https://www.artofpkm.com/pokemon/farfetchd";
    if (sp.dex === 122) return "https://www.artofpkm.com/pokemon/mr_mime";
    return "https://www.artofpkm.com/pokemon/" + sp.key.replace(/-/g, "_");
  }

  function formatDexCode(dex) {
    return "#" + String(dex).padStart(3, "0");
  }

  function getSelectedMon() {
    normalizeRosterLocations();
    return (
      state.roster.find(function (m) {
        return m.uid === state.selectedUid;
      }) || state.roster[0]
    );
  }

  function showBanner(message, metaText, isError) {
    state.lastNotice = {
      message: message || "",
      metaText: metaText || "",
      isError: Boolean(isError)
    };
    refreshSramTelemetry();
  }

  function buildSpeciesOptionsHtml(selectedSpeciesId) {
    return SPECIES_LIST.map(function (sp) {
      const sel = sp.id === selectedSpeciesId ? " selected" : "";
      return (
        '<option value="' +
        sp.id +
        '"' +
        sel +
        ">" +
        formatDexCode(sp.dex) +
        " " +
        escapeHtml(sp.name) +
        " (" +
        toHex(sp.id, 2) +
        ")</option>"
      );
    }).join("");
  }

  function buildMoveOptionsHtml(selectedMoveId) {
    return MOVES_LIST.map(function (mv) {
      const sel = mv.id === selectedMoveId ? " selected" : "";
      const label =
        mv.id === 0x00
          ? mv.name
          : mv.name + " · PP " + String(mv.pp) + " (" + toHex(mv.id, 2) + ")";
      return '<option value="' + mv.id + '"' + sel + ">" + escapeHtml(label) + "</option>";
    }).join("");
  }

  function formatTypeBadgeText(sp) {
    const t1 = (TYPE_NAMES[sp.type1] || "Normal").toUpperCase();
    const t2 = (TYPE_NAMES[sp.type2] || "Normal").toUpperCase();
    return sp.type1 === sp.type2 ? t1 : t1 + " / " + t2;
  }

  function updatePortraitAndReadoutsOnly() {
    const mon = getSelectedMon();
    if (!mon) return;
    const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];
    const slotInfo = computeSlotMap().map.get(mon.uid);

    const imgEl = document.getElementById("selectedMonImg");
    const pipImgEl = document.getElementById("selectedMonPipImg");
    const fallbackEl = document.getElementById("portraitFallback");
    const mainStyle = state.artStyle === "sprite" ? "sprite" : "artwork";
    const pipStyle = mainStyle === "artwork" ? "sprite" : "artwork";
    const targetMainSrc = getSpriteUrl(sp.dex, mainStyle);
    const targetPipSrc = getSpriteUrl(sp.dex, pipStyle);

    imgEl.classList.toggle("pixelated", mainStyle === "sprite");
    if (imgEl.getAttribute("data-current-src") !== targetMainSrc) {
      imgEl.setAttribute("data-current-src", targetMainSrc);
      imgEl.style.display = "block";
      fallbackEl.style.display = "none";
      imgEl.src = targetMainSrc;
    }
    imgEl.alt = sp.name + (mainStyle === "sprite" ? " 8-bit sprite" : " illustration");

    if (pipImgEl) {
      pipImgEl.classList.toggle("pixelated", pipStyle === "sprite");
      if (pipImgEl.getAttribute("data-current-src") !== targetPipSrc) {
        pipImgEl.setAttribute("data-current-src", targetPipSrc);
        pipImgEl.style.display = "block";
        pipImgEl.src = targetPipSrc;
      }
      pipImgEl.alt = sp.name + (pipStyle === "sprite" ? " 8-bit sprite" : " illustration");
    }

    document.getElementById("fallbackDexCode").textContent = formatDexCode(sp.dex);
    document.getElementById("fallbackMonName").textContent = sp.upperName;
    document.getElementById("portraitDexNum").textContent = formatDexCode(sp.dex) + " · " + toHex(sp.id, 2);
    document.getElementById("portraitMonName").textContent = (mon.nickname || sp.upperName).toUpperCase();
    document.getElementById("portraitSubMeta").textContent =
      "Lv. " + String(mon.level) + " · " + (slotInfo ? slotInfo.detailLabel : "Party");
    document.getElementById("artOfPkmLink").href = getArtOfPkmUrl(sp);
    document.getElementById("dexFlavorText").textContent = sp.flavor;
    document.getElementById("miniOledType").textContent = formatTypeBadgeText(sp);
    document.getElementById("miniOledSlot").textContent = slotInfo ? slotInfo.shortLabel : "PARTY #01";
  }

  function buildLocationOptionsHtml(slotData, activeGroupKey) {
    const opts = [
      '<option value="party"' +
        (activeGroupKey === "party" ? " selected" : "") +
        ">Active Party (" +
        String(slotData.partyCount) +
        "/6)</option>"
    ];
    for (let b = 1; b <= 12; b++) {
      const key = "box-" + String(b);
      const count = slotData.boxes[b - 1].length;
      opts.push(
        '<option value="' +
          key +
          '"' +
          (activeGroupKey === key ? " selected" : "") +
          ">PC Box " +
          String(b) +
          " (" +
          String(count) +
          "/20)</option>"
      );
    }
    return opts.join("");
  }

  function buildSlotPositionOptionsHtml(slotData, slotInfo) {
    if (!slotInfo) return '<option value="1">Slot #1</option>';
    const groupMembers =
      slotInfo.kind === "party" ? slotData.party : slotData.boxes[slotInfo.boxNum - 1];
    const total = Math.max(1, groupMembers.length);
    const items = [];
    for (let s = 1; s <= total; s++) {
      const occupant = groupMembers[s - 1];
      const occSp = occupant ? SPECIES_BY_ID.get(occupant.speciesId) : null;
      const suffix =
        slotInfo.kind === "party" && s === 1
          ? " (Lead)"
          : occSp && s !== slotInfo.slotInGroup
            ? " · " + occSp.name
            : "";
      items.push(
        '<option value="' +
          String(s) +
          '"' +
          (s === slotInfo.slotInGroup ? " selected" : "") +
          ">Slot #" +
          String(s) +
          escapeHtml(suffix) +
          "</option>"
      );
    }
    return items.join("");
  }

  function renderDetailSubPane() {
    const mon = getSelectedMon();
    if (!mon) return;
    const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];
    const stats = calculateGen1Stats(sp, mon.level, mon.dvs, mon.statExp);
    const slotData = computeSlotMap();
    const slotInfo = slotData.map.get(mon.uid);
    const pane = document.getElementById("tftDetailPane");

    document.querySelectorAll(".tft-tab-btn").forEach(function (btn) {
      const active = btn.getAttribute("data-subtab") === state.activeSubTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (state.activeSubTab === "stats") {
      const statRows = [
        ["HP", stats.hp, 710, "hp"],
        ["ATK", stats.atk, 420, "atk"],
        ["DEF", stats.def, 460, "def"],
        ["SPD", stats.spd, 420, "spd"],
        ["SPC", stats.spc, 420, "spc"]
      ]
        .map(function (r) {
          const pct = Math.min(100, Math.round((r[1] / r[2]) * 100));
          return (
            '<div class="tft-stat-row">' +
            "<span>" +
            r[0] +
            "</span>" +
            '<strong id="statVal_' +
            r[3] +
            '" class="tabular">' +
            String(r[1]) +
            "</strong>" +
            '<div class="tft-stat-bar"><div id="statBar_' +
            r[3] +
            '" class="tft-stat-fill" style="width:' +
            String(pct) +
            '%"></div></div>' +
            "</div>"
          );
        })
        .join("");

      const activeGroupKey = slotInfo ? slotInfo.groupKey : "party";

      pane.innerHTML =
        "<div>" +
        '<label class="tft-field-label" for="detailSpeciesSelect"><span>SPECIES (#001–#151)</span><span class="tabular">' +
        toHex(sp.id, 2) +
        "</span></label>" +
        '<select id="detailSpeciesSelect">' +
        buildSpeciesOptionsHtml(sp.id) +
        "</select>" +
        "</div>" +
        '<div class="tft-two-col-row">' +
        "<div>" +
        '<label class="tft-field-label" for="detailLocationSelect"><span>BOX / PARTY</span></label>' +
        '<select id="detailLocationSelect">' +
        buildLocationOptionsHtml(slotData, activeGroupKey) +
        "</select>" +
        "</div>" +
        "<div>" +
        '<label class="tft-field-label" for="detailSlotSelect"><span>SLOT ORDER</span></label>' +
        '<select id="detailSlotSelect">' +
        buildSlotPositionOptionsHtml(slotData, slotInfo) +
        "</select>" +
        "</div>" +
        "</div>" +
        '<div class="tft-two-col-row">' +
        "<div>" +
        '<label class="tft-field-label" for="detailLevelNum"><span>LEVEL</span><span id="detailExpReadout" class="tabular">' +
        calculateGen1Experience(sp.expGroup, mon.level).toLocaleString() +
        " XP</span></label>" +
        '<div class="tft-level-inline">' +
        '<input type="range" id="detailLevelRange" min="1" max="100" value="' +
        String(mon.level) +
        '" aria-label="Selected Pokémon Level Slider" />' +
        '<input type="number" id="detailLevelNum" min="1" max="100" value="' +
        String(mon.level) +
        '" class="tabular" aria-label="Selected Pokémon Level Number" />' +
        "</div>" +
        "</div>" +
        "<div>" +
        '<label class="tft-field-label" for="detailNicknameInput"><span>NICKNAME</span><span>10 CHAR</span></label>' +
        '<input type="text" id="detailNicknameInput" maxlength="10" placeholder="' +
        escapeHtml(sp.upperName) +
        '" value="' +
        escapeHtml(mon.nickname || "") +
        '" autocomplete="off" spellcheck="false" />' +
        "</div>" +
        "</div>" +
        '<div class="tft-stats-list">' +
        statRows +
        "</div>";
      return;
    }

    if (state.activeSubTab === "moves") {
      let movesHtml = '<div class="tft-moves-grid">';
      for (let m = 0; m < 4; m++) {
        const mvId = mon.moves[m] || 0x00;
        movesHtml +=
          "<div>" +
          '<label class="tft-field-label" for="detailMoveSelect_' +
          String(m) +
          '"><span>MOVE ' +
          String(m + 1) +
          "</span><span>" +
          toHex(mvId, 2) +
          "</span></label>" +
          '<select id="detailMoveSelect_' +
          String(m) +
          '" data-move-slot="' +
          String(m) +
          '">' +
          buildMoveOptionsHtml(mvId) +
          "</select>" +
          "</div>";
      }
      movesHtml +=
        "</div>" +
        '<div class="tft-mini-actions">' +
        '<button type="button" class="tft-mini-btn" data-sub-action="apply-default-moves">Load Stadium Recommended Moves</button>' +
        "</div>";
      pane.innerHTML = movesHtml;
      return;
    }

    if (state.activeSubTab === "dvs") {
      const packed = packDvBytes(mon.dvs);
      pane.innerHTML =
        "<div>" +
        '<div class="tft-field-label"><span>DVs / IVs (0–15)</span><span id="derivedHpDvReadout" class="tabular">HP DV ' +
        String(stats.hpDv) +
        " · " +
        toHex(packed[0], 2) +
        " " +
        toHex(packed[1], 2) +
        "</span></div>" +
        '<div class="tft-dv-grid">' +
        '<div><label class="tft-field-label" for="dvInput_atk">ATK</label><input id="dvInput_atk" type="number" min="0" max="15" data-dv-key="atk" value="' +
        String(mon.dvs.atk) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="dvInput_def">DEF</label><input id="dvInput_def" type="number" min="0" max="15" data-dv-key="def" value="' +
        String(mon.dvs.def) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="dvInput_spd">SPD</label><input id="dvInput_spd" type="number" min="0" max="15" data-dv-key="spd" value="' +
        String(mon.dvs.spd) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="dvInput_spc">SPC</label><input id="dvInput_spc" type="number" min="0" max="15" data-dv-key="spc" value="' +
        String(mon.dvs.spc) +
        '" /></div>' +
        "</div>" +
        "</div>" +
        "<div>" +
        '<div class="tft-field-label"><span>STAT EXP / EVs (0–65535)</span><span class="tabular">MAX 0xFFFF</span></div>' +
        '<div class="tft-ev-grid">' +
        '<div><label class="tft-field-label" for="evInput_hp">HP</label><input id="evInput_hp" type="number" min="0" max="65535" data-ev-key="hp" value="' +
        String(mon.statExp.hp) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="evInput_atk">ATK</label><input id="evInput_atk" type="number" min="0" max="65535" data-ev-key="atk" value="' +
        String(mon.statExp.atk) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="evInput_def">DEF</label><input id="evInput_def" type="number" min="0" max="65535" data-ev-key="def" value="' +
        String(mon.statExp.def) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="evInput_spd">SPD</label><input id="evInput_spd" type="number" min="0" max="65535" data-ev-key="spd" value="' +
        String(mon.statExp.spd) +
        '" /></div>' +
        '<div><label class="tft-field-label" for="evInput_spc">SPC</label><input id="evInput_spc" type="number" min="0" max="65535" data-ev-key="spc" value="' +
        String(mon.statExp.spc) +
        '" /></div>' +
        "</div>" +
        "</div>" +
        '<div class="tft-mini-actions">' +
        '<button type="button" class="tft-mini-btn" data-sub-action="max-single-stats">Max 15 DVs + 65535 EVs</button>' +
        '<button type="button" class="tft-mini-btn" data-sub-action="zero-single-evs">Zero Stat Exp (Untrained)</button>' +
        "</div>";
      return;
    }

    pane.innerHTML =
      '<div style="font-size:0.8rem;line-height:1.45;color:#d6e9ff;">' +
      '<div class="tft-field-label"><span>CLASSIFICATION &amp; TYPE</span><span>GROWTH RATE</span></div>' +
      '<div style="margin-bottom:8px;" class="tabular">' +
      escapeHtml(formatTypeBadgeText(sp)) +
      " · " +
      escapeHtml(sp.expGroup) +
      "</div>" +
      '<div class="tft-field-label"><span>BASE STATS (RBY)</span><span>INTERNAL HEX</span></div>' +
      '<div style="margin-bottom:10px;" class="tabular">HP ' +
      String(sp.base.hp) +
      " / ATK " +
      String(sp.base.atk) +
      " / DEF " +
      String(sp.base.def) +
      " / SPD " +
      String(sp.base.spd) +
      " / SPC " +
      String(sp.base.spc) +
      " · " +
      toHex(sp.id, 2) +
      "</div>" +
      '<div class="tft-field-label"><span>POKÉDEX ENTRY</span><span>' +
      formatDexCode(sp.dex) +
      "</span></div>" +
      '<p style="margin:4px 0 8px;font-size:0.76rem;color:#9fc4ee;">' +
      escapeHtml(sp.flavor) +
      "</p>" +
      "</div>" +
      '<div class="tft-mini-actions">' +
      '<a class="tft-mini-btn" style="text-decoration:none;display:inline-flex;align-items:center;" href="' +
      escapeHtml(getArtOfPkmUrl(sp)) +
      '" target="_blank" rel="noopener noreferrer">Open ArtOfPKM Reference ↗</a>' +
      "</div>";
  }

  function updateRosterFilterDropdown(slotData) {
    const filterEl = document.getElementById("rosterFilterSelect");
    if (!filterEl) return;
    const current = state.rosterFilter;
    const options = [
      { value: "all", label: "All (" + String(state.roster.length) + ")" },
      { value: "party", label: "Party (" + String(slotData.partyCount) + "/6)" },
      { value: "box", label: "All Boxes (" + String(slotData.boxCount) + ")" }
    ];
    for (let b = 1; b <= 12; b++) {
      const cnt = slotData.boxes[b - 1].length;
      if (cnt > 0 || current === "box-" + String(b)) {
        options.push({
          value: "box-" + String(b),
          label: "Box " + String(b) + " (" + String(cnt) + "/20)"
        });
      }
    }
    const valid = options.some(function (o) {
      return o.value === current;
    });
    if (!valid) state.rosterFilter = "all";

    filterEl.innerHTML = options
      .map(function (o) {
        return (
          '<option value="' +
          o.value +
          '"' +
          (o.value === state.rosterFilter ? " selected" : "") +
          ">" +
          escapeHtml(o.label) +
          "</option>"
        );
      })
      .join("");
  }

  function getFilteredAndSortedRoster(slotDataInput) {
    const slotData = slotDataInput || computeSlotMap();
    const q = state.rosterSearch.trim().toLowerCase();

    const filtered = state.roster.filter(function (mon) {
      const info = slotData.map.get(mon.uid);
      if (!info) return false;
      if (state.rosterFilter === "party" && info.kind !== "party") return false;
      if (state.rosterFilter === "box" && info.kind !== "box") return false;
      if (state.rosterFilter.startsWith("box-")) {
        const bNum = Number.parseInt(state.rosterFilter.slice(4), 10);
        if (info.kind !== "box" || info.boxNum !== bNum) return false;
      }
      if (!q) return true;
      const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];
      const dexStr = formatDexCode(sp.dex).toLowerCase();
      return (
        sp.name.toLowerCase().includes(q) ||
        (mon.nickname || "").toLowerCase().includes(q) ||
        dexStr.includes(q) ||
        String(sp.dex) === q
      );
    });

    const sorted = filtered.slice();
    if (state.rosterSort === "dex") {
      sorted.sort(function (a, b) {
        const spA = SPECIES_BY_ID.get(a.speciesId) || SPECIES_LIST[0];
        const spB = SPECIES_BY_ID.get(b.speciesId) || SPECIES_LIST[0];
        if (spA.dex !== spB.dex) return spA.dex - spB.dex;
        return (slotData.map.get(a.uid).orderRank || 0) - (slotData.map.get(b.uid).orderRank || 0);
      });
    } else if (state.rosterSort === "name") {
      sorted.sort(function (a, b) {
        const spA = SPECIES_BY_ID.get(a.speciesId) || SPECIES_LIST[0];
        const spB = SPECIES_BY_ID.get(b.speciesId) || SPECIES_LIST[0];
        const nameA = (a.nickname || spA.name).toLowerCase();
        const nameB = (b.nickname || spB.name).toLowerCase();
        const cmp = nameA.localeCompare(nameB);
        if (cmp !== 0) return cmp;
        return spA.dex - spB.dex;
      });
    } else {
      sorted.sort(function (a, b) {
        return (slotData.map.get(a.uid).orderRank || 0) - (slotData.map.get(b.uid).orderRank || 0);
      });
    }

    return sorted;
  }

  function renderSavedRosterList() {
    const slotData = computeSlotMap();
    updateRosterFilterDropdown(slotData);
    const filtered = getFilteredAndSortedRoster(slotData);
    const listEl = document.getElementById("savedRosterList");

    if (filtered.length === 0) {
      listEl.innerHTML =
        '<div style="padding:14px;text-align:center;color:#8ca0bd;font-size:0.8rem;">No saved Pokémon match this filter.</div>';
      return;
    }

    listEl.innerHTML = filtered
      .map(function (mon) {
        const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];
        const info = slotData.map.get(mon.uid);
        const isSelected = mon.uid === state.selectedUid;
        const displayLabel = mon.nickname
          ? mon.nickname.toUpperCase() + " (" + sp.name + ")"
          : sp.name;
        const tagClass = info && info.kind === "box" ? "roster-slot-tag box-tag" : "roster-slot-tag";
        return (
          '<button type="button" role="option" aria-selected="' +
          (isSelected ? "true" : "false") +
          '" class="roster-item-btn' +
          (isSelected ? " is-selected" : "") +
          '" data-select-uid="' +
          mon.uid +
          '">' +
          '<span class="roster-dex-code">' +
          formatDexCode(sp.dex) +
          "</span>" +
          '<span class="roster-name-strong">' +
          escapeHtml(displayLabel) +
          " · Lv." +
          String(mon.level) +
          "</span>" +
          '<span class="' +
          tagClass +
          '">' +
          escapeHtml(info ? info.shortLabel : "PARTY") +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function renderPcBoxesTab() {
    const slotData = computeSlotMap();
    const filterBar = document.getElementById("boxesFilterBar");
    const cardsGrid = document.getElementById("boxesCardsGrid");

    const pills = [
      { id: "all", label: "All (" + String(state.roster.length) + ")" },
      { id: "party", label: "Party (" + String(slotData.partyCount) + "/6)" }
    ];
    for (let b = 1; b <= 12; b++) {
      const countInBox = slotData.boxes[b - 1].length;
      if (b <= 3 || countInBox > 0 || state.boxesViewFilter === "box-" + String(b)) {
        pills.push({
          id: "box-" + String(b),
          label: "Box " + String(b) + " (" + String(countInBox) + "/20)"
        });
      }
    }

    filterBar.innerHTML = pills
      .map(function (p) {
        const active = state.boxesViewFilter === p.id;
        return (
          '<button type="button" class="box-pill-btn' +
          (active ? " is-active" : "") +
          '" data-box-filter="' +
          p.id +
          '">' +
          escapeHtml(p.label) +
          "</button>"
        );
      })
      .join("");

    const visibleMons = state.roster.filter(function (mon) {
      const info = slotData.map.get(mon.uid);
      if (!info) return false;
      if (state.boxesViewFilter === "all") return true;
      if (state.boxesViewFilter === "party") return info.kind === "party";
      if (state.boxesViewFilter.startsWith("box-")) {
        const targetBox = Number.parseInt(state.boxesViewFilter.slice(4), 10);
        return info.kind === "box" && info.boxNum === targetBox;
      }
      return true;
    });

    if (visibleMons.length === 0) {
      cardsGrid.innerHTML =
        '<div style="padding:20px;color:var(--text-secondary);">This PC Box is empty. Pick a species above and press + Add, or move a Pokémon here from its Stats card!</div>';
      return;
    }

    cardsGrid.innerHTML = visibleMons
      .map(function (mon) {
        const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];
        const info = slotData.map.get(mon.uid);
        const stats = calculateGen1Stats(sp, mon.level, mon.dvs, mon.statExp);
        return (
          '<article class="storage-mon-card">' +
          '<div class="storage-mon-top">' +
          '<img src="' +
          escapeHtml(getSpriteUrl(sp.dex, state.artStyle)) +
          '" alt="' +
          escapeHtml(sp.name) +
          '" loading="lazy" referrerpolicy="no-referrer" />' +
          '<div style="min-width:0;">' +
          '<div class="tabular" style="font-size:0.68rem;color:#ffb700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          formatDexCode(sp.dex) +
          " · " +
          escapeHtml(info ? info.shortLabel : "") +
          "</div>" +
          '<div style="font-weight:700;font-size:0.84rem;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          escapeHtml(mon.nickname || sp.name) +
          "</div>" +
          '<div class="tabular" style="font-size:0.69rem;color:#9fc4ee;">Lv.' +
          String(mon.level) +
          " · HP " +
          String(stats.hp) +
          "</div>" +
          "</div>" +
          "</div>" +
          '<div class="storage-card-actions">' +
          '<button type="button" class="tft-mini-btn" style="flex:1;padding:4px 6px;min-height:28px;font-size:0.68rem;" data-edit-in-dex="' +
          mon.uid +
          '">Edit Slot</button>' +
          '<button type="button" class="tft-mini-btn" style="padding:4px 6px;min-height:28px;font-size:0.68rem;" data-toggle-loc="' +
          mon.uid +
          '">' +
          (mon.inParty ? "To Box" : "To Party") +
          "</button>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function refreshSramTelemetry() {
    try {
      const compiled = buildGen1SaveBuffer({
        trainerName: state.trainerName,
        trainerId: state.trainerId,
        offsetMode: state.offsetMode,
        roster: state.roster
      });

      const cleanTrainer = sanitizeTrainerName(state.trainerName);
      const chkHex = toHex(compiled.checksum, 2);

      document.getElementById("dexCountBadge").textContent =
        String(compiled.totalCount) + " / 246 SAVED";
      document.getElementById("boxesTabBtn").textContent =
        "Boxes (" + String(compiled.totalCount) + ")";
      document.getElementById("offsetModeHint").textContent =
        state.offsetMode === "retail" ? "0x303C + 12B" : "0x302A Spec";

      const lcdEl = document.getElementById("greenStatusLcd");
      const thirdLine =
        state.lastNotice && state.lastNotice.message
          ? "STATUS: " + state.lastNotice.message
          : "BANK1 CHK: " +
            chkHex +
            " · B2: " +
            toHex(compiled.bank2Checksum, 2) +
            " · B3: " +
            toHex(compiled.bank3Checksum, 2);

      lcdEl.classList.toggle("is-error", Boolean(state.lastNotice && state.lastNotice.isError));
      lcdEl.innerHTML =
        '<span class="lcd-line">TRAINER: ' +
        escapeHtml(cleanTrainer) +
        " (ID " +
        String(clampInt(state.trainerId, 0, 65535, 4919)).padStart(5, "0") +
        ") · CHK " +
        chkHex +
        "</span>" +
        '<span class="lcd-line">PARTY: ' +
        String(compiled.activeCount) +
        "/6 · PC BOXES: " +
        String(compiled.boxCount) +
        "/240</span>" +
        '<span class="lcd-line">' +
        escapeHtml(thirdLine) +
        "</span>";

      const b = compiled.bytes;
      const rows = [
        { offset: "0x2598", label: "Trainer (11B)", hex: formatBytesHex(b.subarray(0x2598, 0x25A3)) },
        { offset: "0x2602", label: "Active Box", hex: formatBytesHex(b.subarray(0x2602, 0x2603)) },
        { offset: "0x284C", label: "Boxes Init", hex: formatBytesHex(b.subarray(0x284C, 0x284D)) },
        { offset: "0x2F2C", label: "Party List", hex: formatBytesHex(b.subarray(0x2F2C, 0x2F2C + compiled.activeCount + 2)) },
        { offset: "0x2F34", label: "Party #1 (44B)", hex: formatBytesHex(b.subarray(0x2F34, 0x2F34 + 44)) },
        { offset: toHex(compiled.otBaseOffset, 4), label: "Party OT #1", hex: formatBytesHex(b.subarray(compiled.otBaseOffset, compiled.otBaseOffset + 11)) },
        { offset: toHex(compiled.nickBaseOffset, 4), label: "Party Nick #1", hex: formatBytesHex(b.subarray(compiled.nickBaseOffset, compiled.nickBaseOffset + 11)) },
        { offset: "0x30C0", label: "Box 1 Mirror", hex: formatBytesHex(b.subarray(0x30C0, 0x30D6)) },
        { offset: "0x3523", label: "Bank 1 Chk", hex: chkHex },
        { offset: "0x5A4C", label: "Bank 2 Chks", hex: formatBytesHex(b.subarray(0x5A4C, 0x5A53)) },
        { offset: "0x7A4C", label: "Bank 3 Chks", hex: formatBytesHex(b.subarray(0x7A4C, 0x7A53)) }
      ];

      document.getElementById("inspectorTableBody").innerHTML = rows
        .map(function (r) {
          return (
            "<tr>" +
            '<td class="tabular">' +
            r.offset +
            "</td>" +
            "<td>" +
            escapeHtml(r.label) +
            "</td>" +
            '<td class="hex-bytes">' +
            r.hex +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    } catch (_err) {
      return;
    }
  }

  function renderAll() {
    normalizeRosterLocations();
    updatePortraitAndReadoutsOnly();
    renderDetailSubPane();
    renderSavedRosterList();
    renderPcBoxesTab();
    refreshSramTelemetry();
  }

  function switchMainTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll(".dex-red-tab").forEach(function (btn) {
      const active = btn.getAttribute("data-tab") === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    ["pokedex", "boxes", "sram", "guide"].forEach(function (id) {
      const leftEl = document.getElementById("left-pane-" + id);
      if (leftEl) leftEl.classList.toggle("is-active", id === tabId);
    });
    const rightMode = tabId === "sram" ? "sram" : tabId === "guide" ? "guide" : "roster";
    ["roster", "sram", "guide"].forEach(function (rId) {
      const rightEl = document.getElementById("right-pane-" + rId);
      if (rightEl) rightEl.classList.toggle("is-active", rId === rightMode);
    });
    if (tabId === "boxes") renderPcBoxesTab();
    if (tabId === "sram") refreshSramTelemetry();
  }

  function stepSelectedMon(delta) {
    const filtered = getFilteredAndSortedRoster();
    if (filtered.length === 0) return;
    const idx = filtered.findIndex(function (m) {
      return m.uid === state.selectedUid;
    });
    const nextIdx = idx === -1 ? 0 : (idx + delta + filtered.length) % filtered.length;
    state.selectedUid = filtered[nextIdx].uid;
    updatePortraitAndReadoutsOnly();
    renderDetailSubPane();
    renderSavedRosterList();
  }

  function toggleMonPartyLocation(uid) {
    const slotData = computeSlotMap();
    const info = slotData.map.get(uid);
    if (!info) return;
    if (info.kind === "party") {
      let targetBox = 1;
      for (let b = 1; b <= 12; b++) {
        if (slotData.boxes[b - 1].length < 20) {
          targetBox = b;
          break;
        }
      }
      movePokemonToGroupAndSlot(uid, "box-" + String(targetBox), slotData.boxes[targetBox - 1].length + 1);
    } else {
      movePokemonToGroupAndSlot(uid, "party", Math.min(6, slotData.partyCount + 1));
    }
  }

  function syncBoxesAddSpeciesPicker(preferredDex) {
    const selEl = document.getElementById("boxesAddSpeciesSelect");
    if (!selEl) return;
    if (!selEl.innerHTML) {
      selEl.innerHTML = SPECIES_LIST.map(function (sp) {
        return '<option value="' + sp.id + '">' + formatDexCode(sp.dex) + " " + escapeHtml(sp.name) + "</option>";
      }).join("");
    }
    if (preferredDex) {
      const targetSp = SPECIES_BY_DEX.get(preferredDex);
      if (targetSp) selEl.value = String(targetSp.id);
    }
  }

  function addNewPokemon(explicitSpeciesId, fromBoxesToolbar) {
    if (state.roster.length >= 246) {
      showBanner("Cartridge full (246/246 Pokémon).", "246 / 246 FULL", true);
      return;
    }
    let candidate = explicitSpeciesId ? SPECIES_BY_ID.get(explicitSpeciesId) : null;
    if (!candidate) {
      const currentMon = getSelectedMon();
      const currentSp = currentMon ? SPECIES_BY_ID.get(currentMon.speciesId) : null;
      const nextDex = currentSp ? (currentSp.dex % 151) + 1 : 1;
      candidate = SPECIES_BY_DEX.get(nextDex) || SPECIES_LIST[0];
    }

    const slotData = computeSlotMap();
    let putInParty = slotData.partyCount < 6;
    let targetBoxNum = 1;

    if (fromBoxesToolbar && state.boxesViewFilter === "party" && slotData.partyCount < 6) {
      putInParty = true;
    } else if (fromBoxesToolbar && state.boxesViewFilter.startsWith("box-")) {
      const bNum = clampInt(state.boxesViewFilter.slice(4), 1, 12, 1);
      if (slotData.boxes[bNum - 1].length < 20) {
        putInParty = false;
        targetBoxNum = bNum;
      }
    } else if (!putInParty) {
      for (let b = 1; b <= 12; b++) {
        if (slotData.boxes[b - 1].length < 20) {
          targetBoxNum = b;
          break;
        }
      }
    }

    const newMon = createMonFromDex(candidate.dex, putInParty, 100, null, targetBoxNum);
    state.roster.push(newMon);
    state.selectedUid = newMon.uid;
    if (!fromBoxesToolbar) {
      state.activeSubTab = "stats";
      switchMainTab("pokedex");
    }
    persistState();
    renderAll();
    syncBoxesAddSpeciesPicker((candidate.dex % 151) + 1);
    if (!fromBoxesToolbar) {
      const speciesSel = document.getElementById("detailSpeciesSelect");
      if (speciesSel) speciesSel.focus();
    }
    showBanner(
      "Added " +
        formatDexCode(candidate.dex) +
        " " +
        candidate.name +
        " to " +
        (newMon.inParty ? "Party." : "PC Box " + String(newMon.boxNum) + "."),
      String(state.roster.length) + " / 246 SAVED",
      false
    );
  }

  function cloneSelectedPokemon() {
    if (state.roster.length >= 246) {
      showBanner("Cartridge full (246 Pokémon).", "246 / 246 FULL", true);
      return;
    }
    const src = getSelectedMon();
    if (!src) return;
    const slotData = computeSlotMap();
    const srcInfo = slotData.map.get(src.uid);
    let inParty = false;
    let targetBox = 1;

    if (src.inParty && slotData.partyCount < 6) {
      inParty = true;
    } else if (srcInfo && srcInfo.kind === "box" && slotData.boxes[srcInfo.boxNum - 1].length < 20) {
      targetBox = srcInfo.boxNum;
    } else {
      for (let b = 1; b <= 12; b++) {
        if (slotData.boxes[b - 1].length < 20) {
          targetBox = b;
          break;
        }
      }
    }

    const copy = {
      uid: allocUid(),
      enabled: true,
      inParty: inParty,
      boxNum: inParty ? 0 : targetBox,
      speciesId: src.speciesId,
      nickname: src.nickname,
      level: src.level,
      moves: src.moves.slice(0, 4),
      dvs: { atk: src.dvs.atk, def: src.dvs.def, spd: src.dvs.spd, spc: src.dvs.spc },
      statExp: {
        hp: src.statExp.hp,
        atk: src.statExp.atk,
        def: src.statExp.def,
        spd: src.statExp.spd,
        spc: src.statExp.spc
      }
    };
    const idx = state.roster.findIndex(function (m) {
      return m.uid === src.uid;
    });
    state.roster.splice(idx + 1, 0, copy);
    state.selectedUid = copy.uid;
    persistState();
    renderAll();
    const sp = SPECIES_BY_ID.get(copy.speciesId) || SPECIES_LIST[0];
    const newInfo = computeSlotMap().map.get(copy.uid);
    showBanner(
      "Duplicated " + sp.name + " into " + (newInfo ? newInfo.detailLabel : "Box") + ".",
      String(state.roster.length) + " / 246 SAVED",
      false
    );
  }

  function deleteSelectedPokemon() {
    if (state.roster.length <= 1) {
      showBanner("Cannot delete the last Pokémon in the save file.", "MIN 1 POKÉMON", true);
      return;
    }
    const target = getSelectedMon();
    if (!target) return;
    const idx = state.roster.findIndex(function (m) {
      return m.uid === target.uid;
    });
    const sp = SPECIES_BY_ID.get(target.speciesId) || SPECIES_LIST[0];
    state.roster.splice(idx, 1);
    normalizeRosterLocations();
    const nextMon = state.roster[Math.min(idx, state.roster.length - 1)];
    if (nextMon) state.selectedUid = nextMon.uid;
    persistState();
    renderAll();
    showBanner("Removed " + sp.name + " from roster.", String(state.roster.length) + " / 246 SAVED", false);
  }

  function triggerExportDownload() {
    try {
      const compiled = buildGen1SaveBuffer({
        trainerName: state.trainerName,
        trainerId: state.trainerId,
        offsetMode: state.offsetMode,
        roster: state.roster
      });
      let outName = (state.fileName || "POKEMON.sav").trim();
      if (!outName.toLowerCase().endsWith(".sav")) {
        outName += ".sav";
      }
      const blob = new Blob([compiled.buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = outName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);

      showBanner(
        "Exported " +
          outName +
          " (32KB) · " +
          String(compiled.activeCount) +
          " Party + " +
          String(compiled.boxCount) +
          " Box Pokémon.",
        "CHK " + toHex(compiled.checksum, 2),
        false
      );
    } catch (err) {
      showBanner(err && err.message ? err.message : "Failed to compile .sav file.", "ERROR", true);
    }
  }

  function togglePortraitArtStyle() {
    state.artStyle = state.artStyle === "artwork" ? "sprite" : "artwork";
    persistState();
    renderAll();
  }

  function attachEventListeners() {
    const imgEl = document.getElementById("selectedMonImg");
    const pipImgEl = document.getElementById("selectedMonPipImg");
    const fallbackEl = document.getElementById("portraitFallback");
    imgEl.addEventListener("load", function () {
      imgEl.style.display = "block";
      fallbackEl.style.display = "none";
    });
    imgEl.addEventListener("error", function () {
      imgEl.style.display = "none";
      fallbackEl.style.display = "flex";
    });
    if (pipImgEl) {
      pipImgEl.addEventListener("load", function () {
        pipImgEl.style.display = "block";
      });
      pipImgEl.addEventListener("error", function () {
        pipImgEl.style.display = "none";
      });
    }

    const portraitFrameBox = document.getElementById("portraitFrameBox");
    if (portraitFrameBox) {
      portraitFrameBox.addEventListener("click", togglePortraitArtStyle);
      portraitFrameBox.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          togglePortraitArtStyle();
        }
      });
    }

    document.querySelectorAll(".dex-red-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchMainTab(btn.getAttribute("data-tab"));
      });
    });

    document.querySelectorAll(".tft-tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.activeSubTab = btn.getAttribute("data-subtab");
        renderDetailSubPane();
      });
    });

    const detailPane = document.getElementById("tftDetailPane");

    detailPane.addEventListener("change", function (ev) {
      const t = ev.target;
      const mon = getSelectedMon();
      if (!t || !mon) return;

      if (t.id === "detailSpeciesSelect") {
        const newId = Number.parseInt(t.value, 10);
        const newSp = SPECIES_BY_ID.get(newId);
        if (newSp) {
          mon.speciesId = newSp.id;
          mon.moves = newSp.defaultMoves.slice(0, 4);
          persistState();
          renderAll();
        }
        return;
      }

      if (t.id === "detailLocationSelect") {
        const targetGroupKey = t.value;
        movePokemonToGroupAndSlot(mon.uid, targetGroupKey, 99);
        return;
      }

      if (t.id === "detailSlotSelect") {
        const slotData = computeSlotMap();
        const info = slotData.map.get(mon.uid);
        if (info) {
          const targetSlot = Number.parseInt(t.value, 10) || 1;
          movePokemonToGroupAndSlot(mon.uid, info.groupKey, targetSlot);
        }
        return;
      }

      if (t.hasAttribute("data-move-slot")) {
        const slotIdx = Number.parseInt(t.getAttribute("data-move-slot"), 10);
        mon.moves[slotIdx] = Number.parseInt(t.value, 10) || 0x00;
        persistState();
        renderDetailSubPane();
        renderPcBoxesTab();
        refreshSramTelemetry();
      }
    });

    detailPane.addEventListener("input", function (ev) {
      const t = ev.target;
      const mon = getSelectedMon();
      if (!t || !mon) return;
      const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];

      if (t.id === "detailLevelRange" || t.id === "detailLevelNum") {
        const lvl = clampInt(t.value, 1, 100, mon.level);
        mon.level = lvl;
        const rangeEl = document.getElementById("detailLevelRange");
        const numEl = document.getElementById("detailLevelNum");
        if (rangeEl && t !== rangeEl) rangeEl.value = String(lvl);
        if (numEl && t !== numEl) numEl.value = String(lvl);
        const expEl = document.getElementById("detailExpReadout");
        if (expEl) expEl.textContent = calculateGen1Experience(sp.expGroup, lvl).toLocaleString() + " XP";

        const stats = calculateGen1Stats(sp, lvl, mon.dvs, mon.statExp);
        const maxCaps = { hp: 710, atk: 420, def: 460, spd: 420, spc: 420 };
        ["hp", "atk", "def", "spd", "spc"].forEach(function (k) {
          const vEl = document.getElementById("statVal_" + k);
          const bEl = document.getElementById("statBar_" + k);
          if (vEl) vEl.textContent = String(stats[k]);
          if (bEl) bEl.style.width = String(Math.min(100, Math.round((stats[k] / maxCaps[k]) * 100))) + "%";
        });
        persistState();
        updatePortraitAndReadoutsOnly();
        renderSavedRosterList();
        refreshSramTelemetry();
        return;
      }

      if (t.id === "detailNicknameInput") {
        mon.nickname = t.value.toUpperCase().replace(/[^A-Z0-9 .'-]/g, "").slice(0, 10);
        persistState();
        updatePortraitAndReadoutsOnly();
        renderSavedRosterList();
        refreshSramTelemetry();
        return;
      }

      if (t.hasAttribute("data-dv-key")) {
        const k = t.getAttribute("data-dv-key");
        mon.dvs[k] = clampInt(t.value, 0, 15, 15);
        const packed = packDvBytes(mon.dvs);
        const readout = document.getElementById("derivedHpDvReadout");
        if (readout) {
          readout.textContent =
            "HP DV " + String(deriveHpDv(mon.dvs)) + " · " + toHex(packed[0], 2) + " " + toHex(packed[1], 2);
        }
        persistState();
        refreshSramTelemetry();
        return;
      }

      if (t.hasAttribute("data-ev-key")) {
        const k = t.getAttribute("data-ev-key");
        mon.statExp[k] = clampInt(t.value, 0, 65535, 0xFFFF);
        persistState();
        refreshSramTelemetry();
      }
    });

    detailPane.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-sub-action]");
      if (!btn) return;
      const act = btn.getAttribute("data-sub-action");
      const mon = getSelectedMon();
      if (!mon) return;
      const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];

      if (act === "apply-default-moves") {
        mon.moves = sp.defaultMoves.slice(0, 4);
        persistState();
        renderDetailSubPane();
        renderPcBoxesTab();
        refreshSramTelemetry();
      } else if (act === "max-single-stats") {
        mon.dvs = { atk: 15, def: 15, spd: 15, spc: 15 };
        mon.statExp = { hp: 0xFFFF, atk: 0xFFFF, def: 0xFFFF, spd: 0xFFFF, spc: 0xFFFF };
        persistState();
        renderDetailSubPane();
        refreshSramTelemetry();
      } else if (act === "zero-single-evs") {
        mon.statExp = { hp: 0, atk: 0, def: 0, spd: 0, spc: 0 };
        persistState();
        renderDetailSubPane();
        refreshSramTelemetry();
      }
    });

    document.getElementById("savedRosterList").addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-select-uid]");
      if (!btn) return;
      state.selectedUid = btn.getAttribute("data-select-uid");
      updatePortraitAndReadoutsOnly();
      renderDetailSubPane();
      renderSavedRosterList();
    });

    document.getElementById("rosterSearchInput").addEventListener("input", function (ev) {
      state.rosterSearch = ev.target.value;
      renderSavedRosterList();
    });

    document.getElementById("rosterFilterSelect").addEventListener("change", function (ev) {
      state.rosterFilter = ev.target.value;
      renderSavedRosterList();
    });

    document.getElementById("rosterSortSelect").addEventListener("change", function (ev) {
      state.rosterSort = ev.target.value;
      persistState();
      renderSavedRosterList();
    });

    document.querySelectorAll("[data-key-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const act = btn.getAttribute("data-key-action");
        if (act === "add-mon") {
          addNewPokemon();
        } else if (act === "clone-mon") {
          cloneSelectedPokemon();
        } else if (act === "swap-party-box") {
          const m = getSelectedMon();
          if (m) toggleMonPartyLocation(m.uid);
        } else if (act === "all-lv100") {
          state.roster.forEach(function (m) {
            m.level = 100;
          });
          persistState();
          renderAll();
          showBanner("Set all " + String(state.roster.length) + " Pokémon to Lv. 100 (Anything Goes).", "ALL LV. 100", false);
        } else if (act === "all-lv50") {
          state.roster.forEach(function (m) {
            m.level = 50;
          });
          persistState();
          renderAll();
          showBanner("Set all " + String(state.roster.length) + " Pokémon to Lv. 50 (Poké Cup).", "ALL LV. 50", false);
        } else if (act === "preset-kids30") {
          state.roster = createKids30Roster();
          state.selectedUid = state.roster[0].uid;
          persistState();
          renderAll();
          showBanner("Loaded 30 Kid Pack (6 Party + 24 PC Box Pokémon).", "30 / 246 SAVED", false);
        } else if (act === "preset-all151") {
          state.roster = createAll151Roster();
          state.selectedUid = state.roster[0].uid;
          persistState();
          renderAll();
          showBanner("Loaded all 151 Pokémon across Party (6) + Boxes 1–8!", "151 / 246 SAVED", false);
        } else if (act === "preset-ou6") {
          state.roster = createCompetitive6Roster();
          state.selectedUid = state.roster[0].uid;
          persistState();
          renderAll();
          showBanner("Loaded 6 RBY Competitive OU Pokémon.", "6 / 246 SAVED", false);
        } else if (act === "max-all-dvs") {
          state.roster.forEach(function (m) {
            m.dvs = { atk: 15, def: 15, spd: 15, spc: 15 };
            m.statExp = { hp: 0xFFFF, atk: 0xFFFF, def: 0xFFFF, spd: 0xFFFF, spc: 0xFFFF };
          });
          persistState();
          renderAll();
          showBanner("Maximized 15 DVs and 65,535 Stat Exp for all Pokémon.", "0xFFFF OPTIMIZED", false);
        } else if (act === "meta-moves") {
          const mon = getSelectedMon();
          if (!mon) return;
          const sp = SPECIES_BY_ID.get(mon.speciesId) || SPECIES_LIST[0];
          mon.moves = sp.defaultMoves.slice(0, 4);
          state.activeSubTab = "moves";
          switchMainTab("pokedex");
          persistState();
          renderDetailSubPane();
          renderPcBoxesTab();
          refreshSramTelemetry();
          showBanner("Applied recommended Stadium moveset to " + sp.name + ".", "MOVES UPDATED", false);
        }
      });
    });

    document.getElementById("toggleArtStyleBtn").addEventListener("click", togglePortraitArtStyle);

    document.getElementById("knobSwapLocationBtn").addEventListener("click", function () {
      const m = getSelectedMon();
      if (m) toggleMonPartyLocation(m.uid);
    });

    document.getElementById("cloneSelectedBtn").addEventListener("click", cloneSelectedPokemon);
    document.getElementById("deleteSelectedBtn").addEventListener("click", deleteSelectedPokemon);

    document.getElementById("dpadUpBtn").addEventListener("click", function () {
      stepSelectedMon(-1);
    });
    document.getElementById("dpadDownBtn").addEventListener("click", function () {
      stepSelectedMon(1);
    });
    document.getElementById("prevMonWhiteBtn").addEventListener("click", function () {
      stepSelectedMon(-1);
    });
    document.getElementById("nextMonWhiteBtn").addEventListener("click", function () {
      stepSelectedMon(1);
    });

    document.getElementById("dpadLeftBtn").addEventListener("click", function () {
      if (state.activeTab !== "pokedex") switchMainTab("pokedex");
      const idx = SUBTABS.indexOf(state.activeSubTab);
      state.activeSubTab = SUBTABS[(idx - 1 + SUBTABS.length) % SUBTABS.length];
      renderDetailSubPane();
    });
    document.getElementById("dpadRightBtn").addEventListener("click", function () {
      if (state.activeTab !== "pokedex") switchMainTab("pokedex");
      const idx = SUBTABS.indexOf(state.activeSubTab);
      state.activeSubTab = SUBTABS[(idx + 1) % SUBTABS.length];
      renderDetailSubPane();
    });

    document.getElementById("exportSavBtn").addEventListener("click", triggerExportDownload);

    document.getElementById("boxesFilterBar").addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-box-filter]");
      if (!btn) return;
      state.boxesViewFilter = btn.getAttribute("data-box-filter");
      renderPcBoxesTab();
    });

    document.getElementById("boxesCardsGrid").addEventListener("click", function (ev) {
      const editBtn = ev.target.closest("[data-edit-in-dex]");
      if (editBtn) {
        state.selectedUid = editBtn.getAttribute("data-edit-in-dex");
        state.activeSubTab = "stats";
        switchMainTab("pokedex");
        updatePortraitAndReadoutsOnly();
        renderDetailSubPane();
        renderSavedRosterList();
        return;
      }
      const locBtn = ev.target.closest("[data-toggle-loc]");
      if (locBtn) {
        toggleMonPartyLocation(locBtn.getAttribute("data-toggle-loc"));
      }
    });

    document.getElementById("boxesAddMonBtn").addEventListener("click", function () {
      const selEl = document.getElementById("boxesAddSpeciesSelect");
      const pickedId = selEl ? Number.parseInt(selEl.value, 10) : 0;
      addNewPokemon(pickedId, true);
    });

    document.getElementById("boxesLoad151Btn").addEventListener("click", function () {
      state.roster = createAll151Roster();
      state.selectedUid = state.roster[0].uid;
      state.boxesViewFilter = "all";
      persistState();
      renderAll();
      showBanner("Loaded all 151 Pokémon into Party + PC Boxes 1–8!", "151 / 246 SAVED", false);
    });

    document.getElementById("trainerNameInput").addEventListener("input", function (ev) {
      state.trainerName = ev.target.value;
      persistState();
      refreshSramTelemetry();
    });

    document.getElementById("trainerIdInput").addEventListener("input", function (ev) {
      state.trainerId = clampInt(ev.target.value, 0, 65535, 4919);
      persistState();
      refreshSramTelemetry();
    });

    document.getElementById("fileNameInput").addEventListener("input", function (ev) {
      state.fileName = ev.target.value;
      persistState();
    });

    document.getElementById("offsetModeSelect").addEventListener("change", function (ev) {
      state.offsetMode = ev.target.value === "spec" ? "spec" : "retail";
      persistState();
      refreshSramTelemetry();
    });

    document.getElementById("resetDefaultRosterBtn").addEventListener("click", function () {
      state.roster = createKids30Roster();
      state.selectedUid = state.roster[0].uid;
      persistState();
      renderAll();
      showBanner("Reset roster to the 30 Kid Pack.", "30 / 246 SAVED", false);
    });

    const importInput = document.getElementById("importSavInput");
    document.getElementById("importSavBtn").addEventListener("click", function () {
      importInput.click();
    });

    importInput.addEventListener("change", function () {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const bytes = new Uint8Array(reader.result);
          const report = inspectSaveBytes(bytes);
          if (report.importedRoster && report.importedRoster.length > 0) {
            state.trainerName = report.trainerName;
            document.getElementById("trainerNameInput").value = report.trainerName;
            state.roster = report.importedRoster.slice(0, 246).map(function (r) {
              return {
                uid: allocUid(),
                enabled: true,
                inParty: Boolean(r.inParty),
                boxNum: r.inParty ? 0 : clampInt(r.boxNum, 1, 12, 1),
                speciesId: r.speciesId,
                nickname: "",
                level: r.level,
                moves: r.moves,
                dvs: r.dvs,
                statExp: r.statExp
              };
            });
            state.selectedUid = state.roster[0].uid;
            persistState();
            renderAll();
          }
          showBanner(
            "Imported " +
              file.name +
              ": " +
              String(report.partyCount) +
              " Party + " +
              String(report.boxCount) +
              " Box Pokémon.",
            report.validChecksum ? "VALID CHK" : "CHK MISMATCH",
            !report.validChecksum
          );
        } catch (err) {
          showBanner(err && err.message ? err.message : "Could not parse .sav file.", "IMPORT ERROR", true);
        }
        importInput.value = "";
      };
      reader.readAsArrayBuffer(file);
    });
  }

  loadSavedState();
  normalizeRosterLocations();
  document.getElementById("trainerNameInput").value = state.trainerName;
  document.getElementById("trainerIdInput").value = String(state.trainerId);
  document.getElementById("fileNameInput").value = state.fileName;
  document.getElementById("offsetModeSelect").value = state.offsetMode;
  document.getElementById("rosterSortSelect").value = state.rosterSort;
  const initMon = getSelectedMon();
  const initSp = initMon ? SPECIES_BY_ID.get(initMon.speciesId) : SPECIES_LIST[0];
  syncBoxesAddSpeciesPicker(initSp ? (initSp.dex % 151) + 1 : 8);
  attachEventListeners();
  renderAll();
})();
