// ============================================================================
// Mob Enchantment Addon — Minecraft Bedrock 1.26.x Script API
// ============================================================================
// When any entity spawns, rolls a 1-in-6 chance to become "enchanted".
// Enchanted mobs gain 1–5 random positive enchantments with weighted levels.
// Enchantments are stored as dynamic properties and applied via event listeners.
// ============================================================================

import { world, system, EntityDamageCause, ItemStack, BlockPermutation } from "@minecraft/server";

// ============================================================================
// ENCHANTMENT POOL — All positive vanilla enchantments (no curses)
// ============================================================================
// Each entry: { id, maxLevel, category }
// category is used to decide which effects to implement
const ENCHANTMENT_POOL = [
    // --- Defensive ---
    { id: "protection", maxLevel: 4, category: "defensive" },
    { id: "projectile_protection", maxLevel: 4, category: "defensive" },
    { id: "fire_protection", maxLevel: 4, category: "defensive" },
    { id: "blast_protection", maxLevel: 4, category: "defensive" },
    { id: "feather_falling", maxLevel: 4, category: "defensive" },
    { id: "thorns", maxLevel: 3, category: "defensive" },
    { id: "respiration", maxLevel: 3, category: "passive" },
    { id: "aqua_affinity", maxLevel: 1, category: "flavor" },

    // --- Movement ---
    { id: "depth_strider", maxLevel: 3, category: "passive" },
    { id: "frost_walker", maxLevel: 2, category: "passive" },
    { id: "soul_speed", maxLevel: 3, category: "passive" },

    // --- Offensive ---
    { id: "sharpness", maxLevel: 5, category: "offensive" },
    { id: "smite", maxLevel: 5, category: "offensive" },
    { id: "bane_of_arthropods", maxLevel: 5, category: "offensive" },
    { id: "knockback", maxLevel: 2, category: "offensive" },
    { id: "fire_aspect", maxLevel: 2, category: "offensive" },
    { id: "looting", maxLevel: 3, category: "flavor" },

    // --- Tool ---
    { id: "efficiency", maxLevel: 5, category: "flavor" },
    { id: "fortune", maxLevel: 3, category: "flavor" },
    { id: "silk_touch", maxLevel: 1, category: "flavor" },
    { id: "unbreaking", maxLevel: 3, category: "flavor" },
    { id: "mending", maxLevel: 1, category: "flavor" },

    // --- Ranged ---
    { id: "power", maxLevel: 5, category: "offensive" },
    { id: "punch", maxLevel: 2, category: "offensive" },
    { id: "flame", maxLevel: 1, category: "offensive" },
    { id: "infinity", maxLevel: 1, category: "flavor" },
    { id: "multishot", maxLevel: 1, category: "flavor" },
    { id: "piercing", maxLevel: 4, category: "flavor" },
    { id: "quick_charge", maxLevel: 3, category: "flavor" },

    // --- Trident ---
    { id: "impaling", maxLevel: 5, category: "offensive" },
    { id: "riptide", maxLevel: 3, category: "flavor" },
    { id: "loyalty", maxLevel: 3, category: "flavor" },
    { id: "channeling", maxLevel: 1, category: "offensive" },

    // --- Fishing ---
    { id: "luck_of_the_sea", maxLevel: 3, category: "flavor" },
    { id: "lure", maxLevel: 3, category: "flavor" },
];

// ============================================================================
// LEVEL WEIGHT TABLE — Higher levels are exponentially rarer
// ============================================================================
// Index 0 = level 1, index 1 = level 2, etc.
const LEVEL_WEIGHTS = [100, 40, 15, 5, 1];

// ============================================================================
// ENCHANT COUNT WEIGHTS — How many enchantments the mob gets
// ============================================================================
// 1 enchant: 50%, 2: 25%, 3: 15%, 4: 9%, 5: 1%
const COUNT_WEIGHTS = [
    { count: 1, weight: 50 },
    { count: 2, weight: 25 },
    { count: 3, weight: 15 },
    { count: 4, weight: 9 },
    { count: 5, weight: 1 },
];

// ============================================================================
// UNDEAD & ARTHROPOD TYPE LISTS — for Smite / Bane of Arthropods targeting
// ============================================================================
const UNDEAD_TYPES = new Set([
    "minecraft:zombie", "minecraft:zombie_villager", "minecraft:husk",
    "minecraft:drowned", "minecraft:skeleton", "minecraft:stray",
    "minecraft:wither_skeleton", "minecraft:zombie_pigman",
    "minecraft:zombified_piglin", "minecraft:phantom", "minecraft:wither",
    "minecraft:zoglin", "minecraft:skeleton_horse", "minecraft:zombie_horse",
    "minecraft:bogged",
]);

const ARTHROPOD_TYPES = new Set([
    "minecraft:spider", "minecraft:cave_spider", "minecraft:silverfish",
    "minecraft:endermite", "minecraft:bee",
]);

const AQUATIC_TYPES = new Set([
    "minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish",
    "minecraft:pufferfish", "minecraft:squid", "minecraft:glow_squid",
    "minecraft:dolphin", "minecraft:turtle", "minecraft:axolotl",
    "minecraft:guardian", "minecraft:elder_guardian", "minecraft:drowned",
]);

// ============================================================================
// NON-MOB ENTITY EXCLUSIONS — these should never be enchanted
// ============================================================================
// These are entity types that have no business being enchanted even if they
// technically have a health component. Everything NOT in this list that has
// a health component IS eligible — including passive mobs (cows, pigs, sheep,
// chickens), hostile mobs, neutral mobs, and bosses (ender dragon, wither).
const NON_MOB_ENTITIES = new Set([
    "minecraft:item", "minecraft:xp_orb", "minecraft:arrow",
    "minecraft:thrown_trident", "minecraft:snowball", "minecraft:egg",
    "minecraft:ender_pearl", "minecraft:fireball", "minecraft:small_fireball",
    "minecraft:wither_skull", "minecraft:wither_skull_dangerous",
    "minecraft:shulker_bullet", "minecraft:dragon_fireball",
    "minecraft:fishing_hook", "minecraft:lingering_potion",
    "minecraft:splash_potion", "minecraft:tnt", "minecraft:falling_block",
    "minecraft:lightning_bolt", "minecraft:area_effect_cloud",
    "minecraft:fireworks_rocket", "minecraft:evocation_fang",
    "minecraft:leash_knot", "minecraft:painting", "minecraft:item_frame",
    "minecraft:ender_crystal", "minecraft:experience_bottle",
    "minecraft:command_block_minecart", "minecraft:chest_minecart",
    "minecraft:hopper_minecart", "minecraft:tnt_minecart",
    "minecraft:minecart", "minecraft:boat", "minecraft:chest_boat",
    "minecraft:wind_charge", "minecraft:breeze_wind_charge_projectile",
    "minecraft:npc",
]);

// ============================================================================
// BONUS LOOT TABLE — Items that can drop from enchanted mobs on death
// ============================================================================
const BONUS_LOOT_TABLE = [
    { item: "minecraft:emerald", weight: 400 },
    { item: "minecraft:iron_ingot", weight: 290 },
    { item: "minecraft:gold_ingot", weight: 290 },
    { item: "minecraft:diamond", weight: 19 },
    { item: "minecraft:netherite_scrap", weight: 1 },
];

// ============================================================================
// DYNAMIC PROPERTY KEY
// ============================================================================
const ENCHANT_PROPERTY = "mob_enchant:enchantments";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Rotate a 3D vector around the Y axis by a given angle in radians.
 */
function rotateY(vector, angleRad) {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return {
        x: vector.x * cos - vector.z * sin,
        y: vector.y,
        z: vector.x * sin + vector.z * cos
    };
}

/**
 * Check if an entity is still valid and loaded.
 * Handles both method and property styles of `isValid` safely.
 */
function isEntityValid(entity) {
    if (!entity) return false;
    if (typeof entity.isValid === "function") {
        try {
            return entity.isValid();
        } catch {
            return false;
        }
    }
    if (typeof entity.isValid === "boolean") {
        return entity.isValid;
    }
    try {
        return entity.typeId !== undefined;
    } catch {
        return false;
    }
}

/**
 * Weighted random pick from an array of { ..., weight } objects.
 */
function weightedRandom(entries) {
    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of entries) {
        roll -= entry.weight;
        if (roll <= 0) return entry;
    }
    return entries[entries.length - 1];
}

/**
 * Roll a level for an enchantment with the given max level.
 * Higher levels are exponentially rarer.
 */
function rollLevel(maxLevel) {
    const candidates = [];
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
        candidates.push({ level: lvl, weight: LEVEL_WEIGHTS[lvl - 1] });
    }
    return weightedRandom(candidates).level;
}

/**
 * Roll how many enchantments the mob should receive (1–5).
 */
function rollEnchantCount() {
    return weightedRandom(COUNT_WEIGHTS).count;
}

/**
 * Shuffle an array in-place (Fisher-Yates).
 */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Pick N unique random enchantments from the pool, each with a rolled level.
 * All enchantments have equal chance of being selected (no bias).
 */
function rollEnchantments(count) {
    // Shuffle the full pool then take the first `count` entries
    const shuffled = shuffle([...ENCHANTMENT_POOL]);
    const picked = shuffled.slice(0, count);

    return picked.map(enchant => ({
        id: enchant.id,
        level: rollLevel(enchant.maxLevel),
        maxLevel: enchant.maxLevel,
        category: enchant.category,
    }));
}

/**
 * Convert a level number to Roman numeral string.
 */
function toRoman(num) {
    const numerals = ["I", "II", "III", "IV", "V"];
    return numerals[num - 1] || num.toString();
}

/**
 * Make a pretty display name from an enchantment ID.
 * e.g. "fire_protection" → "Fire Protection"
 */
function prettyName(id) {
    return id
        .split("_")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/**
 * Get enchantments stored on an entity, or null if not enchanted.
 * @returns {Array|null}
 */
function getEnchantments(entity) {
    try {
        const data = entity.getDynamicProperty(ENCHANT_PROPERTY);
        if (data) return JSON.parse(data);
    } catch {
        // Entity may be invalid or removed
    }
    return null;
}

/**
 * Check if entity has a specific enchantment. Returns the enchant entry or null.
 */
function getEnchant(entity, enchantId) {
    const enchants = getEnchantments(entity);
    if (!enchants) return null;
    return enchants.find(e => e.id === enchantId) || null;
}

/**
 * Calculate a "power score" for a set of enchantments.
 * Used to scale bonus loot and XP. Score = sum of all enchant levels.
 * A mob with Sharpness V + Protection IV = power score 9.
 */
function calculatePowerScore(enchantList) {
    return enchantList.reduce((sum, e) => sum + e.level, 0);
}

/**
 * Set the nameplate of the entity to display its enchantments.
 */
function setEnchantedNameplate(entity, enchantList) {
    try {
        // Build the nametag lines
        // Line 1: ✦ Enchanted header
        let nameTag = "§d§l✦ Enchanted §r\n";

        // Build enchant display — up to 2 per line for readability
        const enchantTexts = enchantList.map(e => {
            const levelStr = e.maxLevel > 1 ? " " + toRoman(e.level) : "";
            // Color code by category
            let color = "§7"; // gray default
            if (e.category === "offensive") color = "§c"; // red
            else if (e.category === "defensive") color = "§b"; // aqua
            else if (e.category === "passive") color = "§a";  // green
            else if (e.category === "flavor") color = "§e";   // yellow

            return `${color}${prettyName(e.id)}${levelStr}§r`;
        });

        // Place enchants, 2 per line
        for (let i = 0; i < enchantTexts.length; i += 2) {
            if (i + 1 < enchantTexts.length) {
                nameTag += enchantTexts[i] + " §8| " + enchantTexts[i + 1];
            } else {
                nameTag += enchantTexts[i];
            }
            if (i + 2 < enchantTexts.length) nameTag += "\n";
        }

        entity.nameTag = nameTag;
    } catch {
        // Entity may have been removed
    }
}

// ============================================================================
// ENTITY TYPE FILTER — Enchant ALL living mobs, not items/projectiles/etc.
// ============================================================================
// This includes EVERY mob in the game:
//   - Passive: cow, pig, sheep, chicken, rabbit, horse, donkey, mule, llama,
//     cat, wolf, fox, panda, parrot, turtle, bee, goat, frog, camel, sniffer...
//   - Neutral: enderman, iron_golem, polar_bear, dolphin, trader_llama...
//   - Hostile: zombie, skeleton, creeper, spider, blaze, ghast, witch...
//   - Bosses: ender_dragon, wither
//   - Everything else with a health component!
// Only players and non-mob entities (items, projectiles, vehicles, etc.) are excluded.
function isMob(entity) {
    try {
        if (!isEntityValid(entity)) return false;
        // Exclude players
        if (entity.typeId === "minecraft:player") return false;
        // Exclude known non-mob entities (projectiles, items, vehicles, etc.)
        if (NON_MOB_ENTITIES.has(entity.typeId)) return false;
        // Final check: must have a health component to be a living mob
        const health = entity.getComponent("minecraft:health");
        return health !== undefined && health !== null;
    } catch {
        return false;
    }
}

// ============================================================================
// ENTITY SPAWN HANDLER — The main dice roll & projectile checks
// ============================================================================
world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (!entity) return;

    // --- Projectile multishot & quick charge logic ---
    const isProj = entity.typeId.includes("arrow") ||
        entity.typeId.includes("potion") ||
        entity.typeId.includes("fireball") ||
        entity.typeId.includes("wither_skull") ||
        entity.typeId.includes("trident");

    if (isProj) {
        system.run(() => {
            if (!isEntityValid(entity)) return;
            const projComp = entity.getComponent("minecraft:projectile");
            if (!projComp) return;

            const owner = projComp.owner;
            if (!owner || !isEntityValid(owner)) return;

            // --- Multishot Ranged ---
            const multishot = getEnchant(owner, "multishot");
            if (multishot) {
                const isShooterEligible = owner.typeId === "minecraft:witch" ||
                    owner.typeId === "minecraft:ender_dragon" ||
                    owner.typeId === "minecraft:wither" ||
                    owner.typeId === "minecraft:skeleton" ||
                    owner.typeId === "minecraft:stray" ||
                    owner.typeId === "minecraft:bogged" ||
                    owner.typeId === "minecraft:piglin" ||
                    entity.typeId.includes("arrow");

                if (isShooterEligible) {
                    const vel = entity.getVelocity();
                    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
                    if (speed > 0.05) {
                        const angle = 0.174; // ~10 degrees
                        const velLeft = rotateY(vel, -angle);
                        const velRight = rotateY(vel, angle);
                        const loc = entity.location;
                        const dim = entity.dimension;
                        const typeId = entity.typeId;

                        try {
                            const projLeft = dim.spawnEntity(typeId, loc);
                            const projRight = dim.spawnEntity(typeId, loc);
                            const compLeft = projLeft.getComponent("minecraft:projectile");
                            const compRight = projRight.getComponent("minecraft:projectile");

                            if (compLeft) {
                                try { compLeft.owner = owner; } catch { }
                                compLeft.shoot(velLeft);
                            }
                            if (compRight) {
                                try { compRight.owner = owner; } catch { }
                                compRight.shoot(velRight);
                            }
                        } catch { }
                    }
                }
            }

            // --- Quick Charge Ranged ---
            const quickCharge = getEnchant(owner, "quick_charge");
            if (quickCharge) {
                const level = quickCharge.level;
                const vel = entity.getVelocity();
                const typeId = entity.typeId;
                const dim = entity.dimension;

                for (let j = 1; j <= level; j++) {
                    const delay = (10 - level * 2) * j;
                    system.runTimeout(() => {
                        if (!isEntityValid(owner)) return;
                        try {
                            const extraProj = dim.spawnEntity(typeId, owner.location);
                            const comp = extraProj.getComponent("minecraft:projectile");
                            if (comp) {
                                try { comp.owner = owner; } catch { }
                                comp.shoot(vel);
                            }
                        } catch { }
                    }, delay);
                }
            }
        });
        return;
    }

    // Only process actual mobs
    if (!isMob(entity)) return;

    // --- DICE ROLL: 1 in 6 chance ---
    const dice = Math.floor(Math.random() * 6) + 1;
    if (dice !== 6) return;

    // --- Roll enchant count ---
    const enchantCount = rollEnchantCount();

    // --- Roll the enchantments ---
    const enchantList = rollEnchantments(enchantCount);

    // --- Store on entity ---
    try {
        entity.setDynamicProperty(ENCHANT_PROPERTY, JSON.stringify(enchantList));
    } catch (e) {
        // Some entities may not support dynamic properties
        return;
    }

    // --- Set nameplate ---
    setEnchantedNameplate(entity, enchantList);

    // --- Apply any instant passive effects ---
    applyPassiveBoosts(entity, enchantList);
});

// ============================================================================
// APPLY PASSIVE BOOSTS — One-time effects applied on spawn
// ============================================================================
function applyPassiveBoosts(entity, enchantList) {
    try {
        for (const enchant of enchantList) {
            switch (enchant.id) {
                case "fire_protection": {
                    // Grant fire resistance for a duration based on level
                    // Level 1: 30s, Level 2: 60s, Level 3: 120s, Level 4: permanent (max ticks)
                    const durations = [600, 1200, 2400, 72000];
                    const dur = durations[Math.min(enchant.level - 1, durations.length - 1)];
                    entity.addEffect("fire_resistance", dur, { amplifier: 0, showParticles: false });
                    break;
                }
                case "respiration": {
                    // Grant water breathing
                    // Level 1: 60s, Level 2: 180s, Level 3: permanent
                    const durations = [1200, 3600, 72000];
                    const dur = durations[Math.min(enchant.level - 1, durations.length - 1)];
                    entity.addEffect("water_breathing", dur, { amplifier: 0, showParticles: false });
                    break;
                }
                case "depth_strider": {
                    // Grant a speed boost (simulates faster water movement)
                    // We apply a permanent slow speed buff — dolphins_grace would be better but
                    // it's not available to mobs, so speed I/II works
                    const amplifier = Math.min(enchant.level - 1, 2);
                    entity.addEffect("speed", 72000, { amplifier: amplifier, showParticles: false });
                    break;
                }
                case "soul_speed": {
                    // Grant a permanent speed boost (simplified — real soul speed is block-dependent)
                    const amplifier = Math.min(enchant.level - 1, 2);
                    entity.addEffect("speed", 72000, { amplifier: amplifier, showParticles: false });
                    break;
                }
                case "protection": {
                    // Grant resistance effect — level 1-2: Resistance I, level 3-4: Resistance II
                    // Resistance I = 20% damage reduction, II = 40%
                    // Protection vanilla is ~4% per level, so Resistance I is roughly equivalent to Prot V
                    // We'll use Resistance I for levels 1-2, Resistance II for 3-4
                    const amplifier = enchant.level >= 3 ? 1 : 0;
                    entity.addEffect("resistance", 72000, { amplifier: amplifier, showParticles: false });
                    break;
                }
                case "feather_falling": {
                    // Grant slow falling for a duration based on level
                    const durations = [600, 1200, 2400, 72000];
                    const dur = durations[Math.min(enchant.level - 1, durations.length - 1)];
                    entity.addEffect("slow_falling", dur, { amplifier: 0, showParticles: false });
                    break;
                }
            }
        }
    } catch {
        // Entity may not support effects
    }
}

// ============================================================================
// OFFENSIVE ENCHANTMENT EFFECTS — Applied when an enchanted mob hits something
// ============================================================================
world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const victim = event.hitEntity;

    if (!isEntityValid(attacker)) return;
    if (!isEntityValid(victim)) return;

    const enchants = getEnchantments(attacker);
    if (!enchants) return;

    for (const enchant of enchants) {
        try {
            switch (enchant.id) {
                // --- MENDING: Heal on hit ---
                case "mending": {
                    const healthComp = attacker.getComponent("minecraft:health");
                    if (healthComp) {
                        const current = healthComp.currentValue;
                        const max = healthComp.effectiveMax;
                        const healAmount = enchant.level * 2;
                        healthComp.setCurrentValue(Math.min(current + healAmount, max));
                        try {
                            attacker.dimension.spawnParticle("minecraft:heart_particle", attacker.location);
                        } catch { }
                    }
                    break;
                }

                // --- QUICK CHARGE: Melee follow-up strike ---
                case "quick_charge": {
                    const level = enchant.level;
                    const delay = 15 - level * 2;
                    system.runTimeout(() => {
                        if (!isEntityValid(attacker) || !isEntityValid(victim)) return;
                        const locA = attacker.location;
                        const locV = victim.location;
                        const distSq = (locA.x - locV.x) ** 2 + (locA.y - locV.y) ** 2 + (locA.z - locV.z) ** 2;
                        if (distSq < 16) {
                            const strikeDamage = 2 + level;
                            victim.applyDamage(strikeDamage, {
                                cause: EntityDamageCause.entityAttack,
                                damagingEntity: attacker
                            });
                            try {
                                victim.dimension.spawnParticle("minecraft:crit_particle", victim.location);
                                victim.dimension.runCommand(
                                    `playsound random.hit @a ${victim.location.x.toFixed(1)} ${victim.location.y.toFixed(1)} ${victim.location.z.toFixed(1)}`
                                );
                            } catch { }
                        }
                    }, delay);
                    break;
                }

                // --- SHARPNESS: Extra flat damage ---
                case "sharpness": {
                    // Vanilla: 0.5 + 0.5 * level extra damage
                    const extraDamage = 0.5 + 0.5 * enchant.level;
                    victim.applyDamage(extraDamage, {
                        cause: EntityDamageCause.entityAttack,
                    });
                    break;
                }

                // --- SMITE: Extra damage to undead ---
                case "smite": {
                    if (UNDEAD_TYPES.has(victim.typeId)) {
                        const extraDamage = 2.5 * enchant.level;
                        victim.applyDamage(extraDamage, {
                            cause: EntityDamageCause.entityAttack,
                        });
                    }
                    break;
                }

                // --- BANE OF ARTHROPODS: Extra damage + slowness to arthropods ---
                case "bane_of_arthropods": {
                    if (ARTHROPOD_TYPES.has(victim.typeId)) {
                        const extraDamage = 2.5 * enchant.level;
                        victim.applyDamage(extraDamage, {
                            cause: EntityDamageCause.entityAttack,
                        });
                        // Apply slowness IV for 1-3.5 seconds (random, like vanilla)
                        const slowDuration = Math.floor(20 * (1 + Math.random() * 1.5 * enchant.level));
                        victim.addEffect("slowness", slowDuration, {
                            amplifier: 3,
                            showParticles: true,
                        });
                    }
                    break;
                }

                // --- FIRE ASPECT: Set target on fire ---
                case "fire_aspect": {
                    // Vanilla: 4 seconds per level
                    victim.setOnFire(4 * enchant.level, true);
                    break;
                }

                // --- KNOCKBACK: Extra knockback ---
                case "knockback": {
                    // Apply a velocity impulse away from the attacker
                    try {
                        const dx = victim.location.x - attacker.location.x;
                        const dz = victim.location.z - attacker.location.z;
                        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                        const power = 0.67 * enchant.level;
                        victim.applyKnockback(dx / dist, dz / dist, power, 0.3 * enchant.level);
                    } catch {
                        // applyKnockback may not be available on all entities
                    }
                    break;
                }

                // --- POWER: Extra damage (for ranged mobs conceptually, but applies to melee too) ---
                case "power": {
                    // Vanilla bow: 25% extra per level
                    const extraDamage = 0.5 * (enchant.level + 1);
                    victim.applyDamage(extraDamage, {
                        cause: EntityDamageCause.entityAttack,
                    });
                    break;
                }

                // --- PUNCH: Extra knockback (ranged conceptually) ---
                case "punch": {
                    try {
                        const dx = victim.location.x - attacker.location.x;
                        const dz = victim.location.z - attacker.location.z;
                        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                        const power = 0.5 * enchant.level;
                        victim.applyKnockback(dx / dist, dz / dist, power, 0.35 * enchant.level);
                    } catch {
                        // applyKnockback may not be available
                    }
                    break;
                }

                // --- FLAME: Set target on fire ---
                case "flame": {
                    victim.setOnFire(5, true);
                    break;
                }

                // --- IMPALING: Extra damage to aquatic mobs ---
                case "impaling": {
                    if (AQUATIC_TYPES.has(victim.typeId)) {
                        const extraDamage = 2.5 * enchant.level;
                        victim.applyDamage(extraDamage, {
                            cause: EntityDamageCause.entityAttack,
                        });
                    }
                    break;
                }

                // --- CHANNELING: Lightning strike during thunderstorms ---
                case "channeling": {
                    try {
                        const dim = attacker.dimension;
                        const loc = victim.location;
                        dim.spawnEntity("minecraft:lightning_bolt", loc);
                    } catch {
                        // May fail if not thundering or command fails
                    }
                    break;
                }
            }
        } catch {
            // Silently handle if the entity was removed mid-processing
        }
    }
});

// ============================================================================
// DEFENSIVE ENCHANTMENT EFFECTS — Applied when an enchanted mob takes damage
// ============================================================================
const activeMultishots = new Set();

world.afterEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    const attacker = event.damageSource?.damagingEntity;
    const damage = event.damage;

    if (!isEntityValid(victim)) return;

    // --- Multishot Melee critical strike (10% chance for 3x damage) ---
    if (attacker && isEntityValid(attacker) && isMob(attacker) && !activeMultishots.has(victim.id)) {
        const multishot = getEnchant(attacker, "multishot");
        if (multishot) {
            const isShooterEligible = attacker.typeId === "minecraft:witch" ||
                attacker.typeId === "minecraft:ender_dragon" ||
                attacker.typeId === "minecraft:wither" ||
                attacker.typeId === "minecraft:skeleton" ||
                attacker.typeId === "minecraft:stray" ||
                attacker.typeId === "minecraft:bogged" ||
                attacker.typeId === "minecraft:piglin";

            if (!isShooterEligible && Math.random() < 0.10) {
                activeMultishots.add(victim.id);
                try {
                    const extraDamage = damage * 2;
                    victim.applyDamage(extraDamage, {
                        cause: EntityDamageCause.entityAttack,
                        damagingEntity: attacker
                    });

                    const loc = victim.location;
                    try {
                        victim.dimension.spawnParticle("minecraft:crit_particle", loc);
                        victim.dimension.runCommand(
                            `playsound random.crit @a ${loc.x.toFixed(1)} ${loc.y.toFixed(1)} ${loc.z.toFixed(1)}`
                        );
                    } catch { }
                    world.sendMessage(`§d§l✦§r §cCritical Multishot! §7An enchanted mob dealt §e3x damage§7!`);
                } catch { }
                activeMultishots.delete(victim.id);
            }
        }
    }

    const enchants = getEnchantments(victim);
    if (!enchants) return;

    for (const enchant of enchants) {
        try {
            switch (enchant.id) {
                // --- THORNS: Reflect damage back to attacker ---
                case "thorns": {
                    if (!isEntityValid(attacker)) break;
                    // Vanilla: level * 15% chance to deal 1-4 damage
                    const thornsChance = enchant.level * 0.15;
                    if (Math.random() < thornsChance) {
                        const thornsDamage = Math.floor(Math.random() * 4) + 1;
                        attacker.applyDamage(thornsDamage, {
                            cause: EntityDamageCause.thorns,
                        });
                    }
                    break;
                }

                // --- BLAST PROTECTION: Reduce explosion knockback ---
                case "blast_protection": {
                    if (event.damageSource?.cause === EntityDamageCause.blockExplosion ||
                        event.damageSource?.cause === EntityDamageCause.entityExplosion) {
                        // Give brief resistance to reduce further explosion damage
                        victim.addEffect("resistance", 20, {
                            amplifier: Math.min(enchant.level - 1, 3),
                            showParticles: false,
                        });
                    }
                    break;
                }

                // --- PROJECTILE PROTECTION: Brief resistance when hit by projectile ---
                case "projectile_protection": {
                    if (event.damageSource?.cause === EntityDamageCause.projectile) {
                        victim.addEffect("resistance", 20, {
                            amplifier: Math.min(enchant.level - 1, 3),
                            showParticles: false,
                        });
                    }
                    break;
                }
            }
        } catch {
            // Silently handle
        }
    }
});

// ============================================================================
// BONUS LOOT & XP — Enchanted mobs drop better rewards on death
// ============================================================================
// Scales with: number of enchantments × sum of enchant levels (power score)
// More enchants + higher levels = significantly more XP and rarer loot
world.afterEvents.entityDie.subscribe((event) => {
    const deadEntity = event.deadEntity;
    const damageSource = event.damageSource;

    if (!deadEntity) return;

    // Clean up Infinity alerts map
    try {
        lastInfinityAlertMap.delete(deadEntity.id);
    } catch { }

    // Read enchantments before the entity is fully gone
    let enchants;
    try {
        enchants = getEnchantments(deadEntity);
    } catch {
        return;
    }
    if (!enchants || enchants.length === 0) return;

    const powerScore = calculatePowerScore(enchants);
    const enchantCount = enchants.length;

    // --- BONUS XP ---
    // Base XP bonus: 3 per enchant + 2 per power level
    // A mob with 3 enchants totaling power 8 gets: 9 + 16 = 25 bonus XP
    // A mob with 5 enchants totaling power 15 gets: 15 + 30 = 45 bonus XP
    const bonusXP = (enchantCount * 3) + (powerScore * 2);

    // Spawn XP orbs at the death location
    try {
        const loc = deadEntity.location;
        const dim = deadEntity.dimension;

        // Add XP directly to the killing player if it was a player kill
        const killer = damageSource?.damagingEntity;
        if (killer && killer.typeId === "minecraft:player") {
            try {
                killer.addExperience(bonusXP);
            } catch {
                // Fallback: spawn XP orbs at location via summon
                const orbCount = Math.min(Math.ceil(bonusXP / 5), 10);
                for (let i = 0; i < orbCount; i++) {
                    const ox = loc.x + (Math.random() - 0.5) * 1.0;
                    const oz = loc.z + (Math.random() - 0.5) * 1.0;
                    try {
                        dim.runCommand(`summon xp_orb ${ox.toFixed(1)} ${loc.y.toFixed(1)} ${oz.toFixed(1)}`);
                    } catch { /* ignore */ }
                }
            }
        } else {
            // Non-player kill — spawn XP orbs at the location
            const orbCount = Math.min(Math.ceil(bonusXP / 5), 10);
            for (let i = 0; i < orbCount; i++) {
                const ox = loc.x + (Math.random() - 0.5) * 1.0;
                const oz = loc.z + (Math.random() - 0.5) * 1.0;
                try {
                    dim.runCommand(`summon xp_orb ${ox.toFixed(1)} ${loc.y.toFixed(1)} ${oz.toFixed(1)}`);
                } catch { /* ignore */ }
            }
        }

        // --- BONUS LOOT ---
        // Scales with number of enchantments and sum of enchant levels (powerScore).
        // Cap at 200 items.
        let totalItemsToDrop = Math.floor(enchantCount * powerScore * 1.5);
        if (totalItemsToDrop < 1) totalItemsToDrop = 1;
        if (totalItemsToDrop > 200) totalItemsToDrop = 200;

        // Group the drops into stacks to prevent massive lag
        const drops = {};
        for (let i = 0; i < totalItemsToDrop; i++) {
            const lootEntry = weightedRandom(BONUS_LOOT_TABLE);
            if (!drops[lootEntry.item]) drops[lootEntry.item] = 0;
            drops[lootEntry.item]++;
        }

        for (const itemId in drops) {
            let amount = drops[itemId];
            while (amount > 0) {
                const stackSize = Math.min(amount, 64);
                amount -= stackSize;

                const ix = loc.x + (Math.random() - 0.5) * 0.8;
                const iz = loc.z + (Math.random() - 0.5) * 0.8;
                try {
                    const itemStack = new ItemStack(itemId, stackSize);
                    dim.spawnItem(itemStack, { x: ix, y: loc.y + 0.5, z: iz });
                } catch {
                    // Fallback
                    try { dim.runCommand(`give @p[r=24] ${itemId} ${stackSize}`); } catch { }
                }
            }
        }

        // --- DEATH MESSAGE ---
        // Announce the enchanted mob's death with loot info
        const enchantNames = enchants.map(e => {
            const lvl = e.maxLevel > 1 ? " " + toRoman(e.level) : "";
            return prettyName(e.id) + lvl;
        }).join(", ");

        const mobName = deadEntity.typeId.replace("minecraft:", "");
        const prettyMobName = prettyName(mobName);
        world.sendMessage(
            `§d§l✦§r §7An enchanted §f${prettyMobName}§7 has been slain! ` +
            `§8[§e${enchantNames}§8] ` +
            `§6+${bonusXP} bonus XP §8| §a${totalLootRolls} bonus drops`
        );

    } catch {
        // Entity location may not be accessible after death
    }
});

// ============================================================================
// PASSIVE EFFECT REFRESH — Re-apply timed passive effects periodically
// ============================================================================
// Every 30 seconds, refresh passive effects on enchanted mobs so they don't expire
// This covers respiration, depth_strider, soul_speed, fire_protection, protection
system.runInterval(() => {
    try {
        for (const dimension of [
            world.getDimension("overworld"),
            world.getDimension("nether"),
            world.getDimension("the_end"),
        ]) {
            try {
                const entities = dimension.getEntities();
                for (const entity of entities) {
                    if (!isEntityValid(entity)) continue;
                    if (entity.typeId === "minecraft:player") continue;

                    const enchants = getEnchantments(entity);
                    if (!enchants) continue;

                    // Refresh passive effects
                    applyPassiveBoosts(entity, enchants);
                }
            } catch {
                // Dimension may not be loaded
            }
        }
    } catch {
        // Silently handle
    }
}, 600); // Every 600 ticks = 30 seconds

// ============================================================================
// ENCHANTMENT PARTICLE EFFECT — Visual indicator for enchanted mobs
// ============================================================================
// Every 2 seconds, spawn subtle particles around enchanted mobs
system.runInterval(() => {
    try {
        for (const dimension of [
            world.getDimension("overworld"),
            world.getDimension("nether"),
            world.getDimension("the_end"),
        ]) {
            try {
                const entities = dimension.getEntities();
                for (const entity of entities) {
                    if (!isEntityValid(entity)) continue;
                    if (entity.typeId === "minecraft:player") continue;

                    const enchants = getEnchantments(entity);
                    if (!enchants) continue;

                    // Spawn enchantment table particles around the mob
                    const loc = entity.location;
                    for (let i = 0; i < 3; i++) {
                        const offsetX = (Math.random() - 0.5) * 1.5;
                        const offsetY = Math.random() * 1.5;
                        const offsetZ = (Math.random() - 0.5) * 1.5;
                        try {
                            dimension.spawnParticle(
                                "minecraft:enchanting_table_particle",
                                {
                                    x: loc.x + offsetX,
                                    y: loc.y + offsetY,
                                    z: loc.z + offsetZ,
                                }
                            );
                        } catch {
                            // Particle spawn may fail
                        }
                    }
                }
            } catch {
                // Dimension may not be loaded
            }
        }
    } catch {
        // Silently handle
    }
}, 40); // Every 40 ticks = 2 seconds

// ============================================================================
// BEFORE HURT EVENT — Used for damage prevention / immunity logic
// ============================================================================
const lastInfinityAlertMap = new Map();

world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    if (!isMob(victim)) return;

    // --- INFINITY: Complete invulnerability until broken by a potion ---
    const infinityEnchant = getEnchant(victim, "infinity");
    if (infinityEnchant) {
        let isBroken = false;
        try {
            isBroken = victim.getDynamicProperty("mob_enchant:infinity_broken") === true;
        } catch { }

        if (!isBroken) {
            event.cancel = true;

            const now = Date.now();
            const lastAlert = lastInfinityAlertMap.get(victim.id) || 0;
            if (now - lastAlert > 2000) {
                lastInfinityAlertMap.set(victim.id, now);
                system.run(() => {
                    if (!isEntityValid(victim)) return;
                    const loc = victim.location;
                    try {
                        victim.dimension.spawnParticle("minecraft:guardian_attack_particle", loc);
                        victim.dimension.runCommand(
                            `playsound random.anvil_land @a ${loc.x.toFixed(1)} ${loc.y.toFixed(1)} ${loc.z.toFixed(1)} 0.5 2`
                        );
                    } catch { }

                    const attacker = event.damageSource?.damagingEntity;
                    if (attacker && attacker.typeId === "minecraft:player") {
                        world.sendMessage("§d§l✦§r §eInfinity Shield§7 is active! Splashing any potion effect onto this mob will break it.");
                    }
                });
            }
            return;
        }
    }

    // --- UNBREAKING: Revive on fatal damage (totem effect) ---
    const unbreakingEnchant = getEnchant(victim, "unbreaking");
    if (unbreakingEnchant) {
        const healthComp = victim.getComponent("minecraft:health");
        if (healthComp && event.damage >= healthComp.currentValue) {
            const surviveChance = unbreakingEnchant.level * 0.10;
            if (Math.random() < surviveChance) {
                event.cancel = true;

                system.run(() => {
                    if (!isEntityValid(victim)) return;
                    const hComp = victim.getComponent("minecraft:health");
                    if (hComp) {
                        hComp.resetToMaxValue();
                    }

                    const loc = victim.location;
                    const dim = victim.dimension;
                    try {
                        dim.spawnParticle("minecraft:totem_particle", loc);
                        dim.runCommand(
                            `playsound random.totem @a ${loc.x.toFixed(1)} ${loc.y.toFixed(1)} ${loc.z.toFixed(1)}`
                        );
                    } catch { }
                });
            }
        }
    }
});

// ============================================================================
// EFFECT ADDED EVENT — Breaking Infinity Shield
// ============================================================================
world.afterEvents.effectAdd.subscribe((event) => {
    const entity = event.entity;
    if (!isMob(entity)) return;

    const infinity = getEnchant(entity, "infinity");
    if (!infinity) return;

    try {
        const isBroken = entity.getDynamicProperty("mob_enchant:infinity_broken") === true;
        if (!isBroken) {
            entity.setDynamicProperty("mob_enchant:infinity_broken", true);
            const loc = entity.location;
            try {
                entity.dimension.runCommand(
                    `playsound random.break @a ${loc.x.toFixed(1)} ${loc.y.toFixed(1)} ${loc.z.toFixed(1)}`
                );
            } catch { }
        }
    } catch { }
});

// ============================================================================
// FROST WALKER TICK RUNNER — Convert water underfoot to ice
// ============================================================================
system.runInterval(() => {
    try {
        for (const dimension of [
            world.getDimension("overworld"),
            world.getDimension("nether"),
            world.getDimension("the_end"),
        ]) {
            try {
                const entities = dimension.getEntities();
                for (const entity of entities) {
                    if (!isEntityValid(entity)) continue;
                    if (entity.typeId === "minecraft:player") continue;

                    const fw = getEnchant(entity, "frost_walker");
                    if (!fw) continue;

                    const loc = entity.location;
                    const radius = fw.level + 1;
                    const centerY = Math.floor(loc.y) - 1;
                    const centerX = Math.floor(loc.x);
                    const centerZ = Math.floor(loc.z);
                    const dim = entity.dimension;

                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dz = -radius; dz <= radius; dz++) {
                            if (dx * dx + dz * dz > radius * radius) continue;
                            try {
                                const bx = centerX + dx;
                                const bz = centerZ + dz;
                                const block = dim.getBlock({ x: bx, y: centerY, z: bz });
                                if (block && block.typeId === "minecraft:water") {
                                    const blockAbove = dim.getBlock({ x: bx, y: centerY + 1, z: bz });
                                    if (blockAbove && blockAbove.typeId === "minecraft:air") {
                                        block.setPermutation(BlockPermutation.resolve("minecraft:frosted_ice"));
                                    }
                                }
                            } catch { }
                        }
                    }
                }
            } catch { }
        }
    } catch { }
}, 5);

// ============================================================================
// PLAYER COMMAND — /scriptevent mobenchant:<action> — Manually enchant mobs
// ============================================================================
// Usage (type these in Minecraft's / command bar):
//   /scriptevent mobenchant:enchant                — Random enchantments on nearest mob
//   /scriptevent mobenchant:enchant sharpness 5    — Add specific enchantment at level
//   /scriptevent mobenchant:random 3               — Add N random enchantments (1-5)
//   /scriptevent mobenchant:clear                  — Remove all enchantments from nearest mob
//   /scriptevent mobenchant:list                   — Show all available enchantments
//   /scriptevent mobenchant:info                   — Inspect nearest mob's enchantments
//   /scriptevent mobenchant:help                   — Show command help
// Maximum of 5 enchantments per mob.
// ============================================================================

const MAX_ENCHANTS = 5;
const MOB_SEARCH_RADIUS = 5; // blocks

/**
 * Find the nearest mob to a player within a given radius.
 * Excludes players and non-mob entities.
 */
function findNearestMob(player, radius) {
    try {
        const entities = player.dimension.getEntities({
            location: player.location,
            maxDistance: radius,
            excludeTypes: ["minecraft:player"],
        });

        let nearest = null;
        let nearestDistSq = Infinity;

        for (const entity of entities) {
            if (!isEntityValid(entity)) continue;
            if (!isMob(entity)) continue;

            const dx = entity.location.x - player.location.x;
            const dy = entity.location.y - player.location.y;
            const dz = entity.location.z - player.location.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = entity;
            }
        }

        return nearest;
    } catch {
        return null;
    }
}

/**
 * Look up an enchantment definition from the pool by ID.
 * Supports partial matching (e.g. "sharp" matches "sharpness").
 */
function findEnchantDef(query) {
    const lower = query.toLowerCase().replace(/\s+/g, "_");

    // Exact match first
    const exact = ENCHANTMENT_POOL.find(e => e.id === lower);
    if (exact) return exact;

    // Partial / prefix match
    const partial = ENCHANTMENT_POOL.find(e => e.id.startsWith(lower));
    if (partial) return partial;

    // Contains match
    const contains = ENCHANTMENT_POOL.find(e => e.id.includes(lower));
    return contains || null;
}

/**
 * Apply enchantments to a mob and update its nameplate + passive boosts.
 */
function applyEnchantmentsToMob(entity, enchantList) {
    try {
        entity.setDynamicProperty(ENCHANT_PROPERTY, JSON.stringify(enchantList));
        setEnchantedNameplate(entity, enchantList);
        applyPassiveBoosts(entity, enchantList);
        return true;
    } catch {
        return false;
    }
}

/**
 * Send a styled message to a specific player.
 */
function tellPlayer(player, msg) {
    try {
        player.sendMessage(msg);
    } catch {
        // Fallback: use world message (visible to all)
        try { world.sendMessage(msg); } catch {}
    }
}

// --- /scriptevent Command Handler ---
system.afterEvents.scriptEventReceive.subscribe((event) => {
    // Only handle events in our namespace
    if (!event.id.startsWith("mobenchant:")) return;

    // Only handle commands from players
    const player = event.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") return;

    const action = event.id.replace("mobenchant:", "");
    const message = event.message?.trim() || "";
    const args = message.split(/\s+/).filter(a => a.length > 0);

    // --- HELP ---
    if (action === "help") {
        tellPlayer(player, `§d§l✦ Mob Enchant Commands §r`);
        tellPlayer(player, `§e/scriptevent mobenchant:enchant§7 — Random enchants on nearest mob`);
        tellPlayer(player, `§e/scriptevent mobenchant:enchant <name> [level]§7 — Add specific`);
        tellPlayer(player, `§e/scriptevent mobenchant:random [count]§7 — Add N random (1-5)`);
        tellPlayer(player, `§e/scriptevent mobenchant:clear§7 — Remove all enchantments`);
        tellPlayer(player, `§e/scriptevent mobenchant:list§7 — Show all enchantment names`);
        tellPlayer(player, `§e/scriptevent mobenchant:info§7 — Inspect nearest mob`);
        tellPlayer(player, `§e/scriptevent mobenchant:help§7 — Show this help`);
        tellPlayer(player, `§8Max §f${MAX_ENCHANTS}§8 enchantments per mob. Range: §f${MOB_SEARCH_RADIUS}§8 blocks.`);
        return;
    }

    // --- LIST ---
    if (action === "list") {
        tellPlayer(player, `§d§l✦ Available Enchantments §r`);

        const categories = { offensive: [], defensive: [], passive: [], flavor: [] };
        for (const e of ENCHANTMENT_POOL) {
            categories[e.category].push(e);
        }

        const catColors = { offensive: "§c", defensive: "§b", passive: "§a", flavor: "§e" };
        const catNames = { offensive: "Offensive", defensive: "Defensive", passive: "Movement", flavor: "Utility" };

        for (const cat of ["offensive", "defensive", "passive", "flavor"]) {
            const entries = categories[cat];
            if (entries.length === 0) continue;
            const names = entries.map(e => `${prettyName(e.id)} (${e.maxLevel})`).join("§7, " + catColors[cat]);
            tellPlayer(player, `${catColors[cat]}§l${catNames[cat]}:§r ${catColors[cat]}${names}`);
        }
        return;
    }

    // --- Commands that require a target mob ---
    const target = findNearestMob(player, MOB_SEARCH_RADIUS);
    if (!target) {
        tellPlayer(player, `§d§l✦§r §cNo mob found within ${MOB_SEARCH_RADIUS} blocks! Get closer to a mob.`);
        return;
    }

    const mobTypeName = prettyName(target.typeId.replace("minecraft:", ""));

    // --- INFO ---
    if (action === "info") {
        const enchants = getEnchantments(target);
        if (!enchants || enchants.length === 0) {
            tellPlayer(player, `§d§l✦§r §7The §f${mobTypeName}§7 has no enchantments.`);
        } else {
            tellPlayer(player, `§d§l✦ ${mobTypeName} — Enchantments (${enchants.length}/${MAX_ENCHANTS}) §r`);
            for (const e of enchants) {
                const lvlStr = e.maxLevel > 1 ? " " + toRoman(e.level) : "";
                let color = "§7";
                if (e.category === "offensive") color = "§c";
                else if (e.category === "defensive") color = "§b";
                else if (e.category === "passive") color = "§a";
                else if (e.category === "flavor") color = "§e";
                tellPlayer(player, `  ${color}• ${prettyName(e.id)}${lvlStr}§r`);
            }
            tellPlayer(player, `§8Power Score: §f${calculatePowerScore(enchants)}`);
        }
        return;
    }

    // --- CLEAR ---
    if (action === "clear") {
        const enchants = getEnchantments(target);
        if (!enchants || enchants.length === 0) {
            tellPlayer(player, `§d§l✦§r §7The §f${mobTypeName}§7 has no enchantments to remove.`);
            return;
        }
        try {
            target.setDynamicProperty(ENCHANT_PROPERTY, undefined);
            target.nameTag = "";
            // Remove passive effects
            try {
                target.removeEffect("fire_resistance");
                target.removeEffect("water_breathing");
                target.removeEffect("speed");
                target.removeEffect("resistance");
                target.removeEffect("slow_falling");
            } catch {}
            tellPlayer(player, `§d§l✦§r §aCleared all enchantments from §f${mobTypeName}§a!`);
        } catch {
            tellPlayer(player, `§d§l✦§r §cFailed to clear enchantments.`);
        }
        return;
    }

    // --- RANDOM [count] ---
    if (action === "random") {
        let count = 0;
        if (args.length > 0) {
            count = parseInt(args[0]);
            if (isNaN(count) || count < 1) count = 1;
            if (count > MAX_ENCHANTS) count = MAX_ENCHANTS;
        }

        // Check existing enchantments
        const existing = getEnchantments(target) || [];
        const slotsLeft = MAX_ENCHANTS - existing.length;

        if (slotsLeft <= 0) {
            tellPlayer(player, `§d§l✦§r §cThe §f${mobTypeName}§c already has ${MAX_ENCHANTS}/${MAX_ENCHANTS} enchantments! Use §e/scriptevent mobenchant:clear§c first.`);
            return;
        }

        // Determine how many to add
        if (count === 0) {
            count = Math.min(rollEnchantCount(), slotsLeft);
        } else {
            count = Math.min(count, slotsLeft);
        }

        // Filter out enchantments the mob already has
        const existingIds = new Set(existing.map(e => e.id));
        const available = ENCHANTMENT_POOL.filter(e => !existingIds.has(e.id));

        if (available.length === 0) {
            tellPlayer(player, `§d§l✦§r §cNo more unique enchantments available for this mob!`);
            return;
        }

        count = Math.min(count, available.length);
        const shuffled = shuffle([...available]);
        const newEnchants = shuffled.slice(0, count).map(e => ({
            id: e.id,
            level: rollLevel(e.maxLevel),
            maxLevel: e.maxLevel,
            category: e.category,
        }));

        const combined = [...existing, ...newEnchants];

        if (applyEnchantmentsToMob(target, combined)) {
            const added = newEnchants.map(e => {
                const lvl = e.maxLevel > 1 ? " " + toRoman(e.level) : "";
                return `§e${prettyName(e.id)}${lvl}§r`;
            }).join("§7, ");
            tellPlayer(player, `§d§l✦§r §aEnchanted §f${mobTypeName}§a with: ${added}`);
            tellPlayer(player, `§8Total: §f${combined.length}/${MAX_ENCHANTS}§8 enchantments`);
        } else {
            tellPlayer(player, `§d§l✦§r §cFailed to enchant the mob.`);
        }
        return;
    }

    // --- ENCHANT [name] [level] ---
    if (action === "enchant") {
        // No arguments = random enchantment
        if (args.length === 0) {
            const existing = getEnchantments(target) || [];
            const slotsLeft = MAX_ENCHANTS - existing.length;

            if (slotsLeft <= 0) {
                tellPlayer(player, `§d§l✦§r §cThe §f${mobTypeName}§c already has ${MAX_ENCHANTS}/${MAX_ENCHANTS} enchantments! Use §e/scriptevent mobenchant:clear§c first.`);
                return;
            }

            const count = Math.min(rollEnchantCount(), slotsLeft);
            const existingIds = new Set(existing.map(e => e.id));
            const available = ENCHANTMENT_POOL.filter(e => !existingIds.has(e.id));

            if (available.length === 0) {
                tellPlayer(player, `§d§l✦§r §cNo more unique enchantments available for this mob!`);
                return;
            }

            const actualCount = Math.min(count, available.length);
            const shuffled = shuffle([...available]);
            const newEnchants = shuffled.slice(0, actualCount).map(e => ({
                id: e.id,
                level: rollLevel(e.maxLevel),
                maxLevel: e.maxLevel,
                category: e.category,
            }));

            const combined = [...existing, ...newEnchants];

            if (applyEnchantmentsToMob(target, combined)) {
                const added = newEnchants.map(e => {
                    const lvl = e.maxLevel > 1 ? " " + toRoman(e.level) : "";
                    return `§e${prettyName(e.id)}${lvl}§r`;
                }).join("§7, ");
                tellPlayer(player, `§d§l✦§r §aEnchanted §f${mobTypeName}§a with: ${added}`);
                tellPlayer(player, `§8Total: §f${combined.length}/${MAX_ENCHANTS}§8 enchantments`);
            } else {
                tellPlayer(player, `§d§l✦§r §cFailed to enchant the mob.`);
            }
            return;
        }

        // Specific enchantment: /scriptevent mobenchant:enchant sharpness 5
        const enchantName = args[0].toLowerCase();
        const enchantDef = findEnchantDef(enchantName);
        if (!enchantDef) {
            tellPlayer(player, `§d§l✦§r §cUnknown enchantment: §f${enchantName}`);
            tellPlayer(player, `§7Use §e/scriptevent mobenchant:list§7 to see all available enchantments.`);
            return;
        }

        // Parse optional level
        let level = 0;
        if (args.length > 1) {
            level = parseInt(args[1]);
            if (isNaN(level) || level < 1) level = 1;
            if (level > enchantDef.maxLevel) level = enchantDef.maxLevel;
        } else {
            level = rollLevel(enchantDef.maxLevel);
        }

        // Check existing enchantments
        const existing = getEnchantments(target) || [];
        const existingIdx = existing.findIndex(e => e.id === enchantDef.id);

        if (existingIdx !== -1) {
            // Update existing enchantment level
            existing[existingIdx].level = level;
            if (applyEnchantmentsToMob(target, existing)) {
                const lvlStr = enchantDef.maxLevel > 1 ? " " + toRoman(level) : "";
                tellPlayer(player, `§d§l✦§r §aUpdated §f${mobTypeName}§a's §e${prettyName(enchantDef.id)}${lvlStr}§a!`);
            } else {
                tellPlayer(player, `§d§l✦§r §cFailed to update enchantment.`);
            }
            return;
        }

        // Adding new enchantment — check cap
        if (existing.length >= MAX_ENCHANTS) {
            tellPlayer(player, `§d§l✦§r §cThe §f${mobTypeName}§c already has ${MAX_ENCHANTS}/${MAX_ENCHANTS} enchantments!`);
            tellPlayer(player, `§7Use §e/scriptevent mobenchant:clear§7 to remove them, or specify an existing enchant to update its level.`);
            return;
        }

        const newEnchant = {
            id: enchantDef.id,
            level: level,
            maxLevel: enchantDef.maxLevel,
            category: enchantDef.category,
        };

        const combined = [...existing, newEnchant];

        if (applyEnchantmentsToMob(target, combined)) {
            const lvlStr = enchantDef.maxLevel > 1 ? " " + toRoman(level) : "";
            tellPlayer(player, `§d§l✦§r §aAdded §e${prettyName(enchantDef.id)}${lvlStr}§a to §f${mobTypeName}§a!`);
            tellPlayer(player, `§8Total: §f${combined.length}/${MAX_ENCHANTS}§8 enchantments`);
        } else {
            tellPlayer(player, `§d§l✦§r §cFailed to enchant the mob.`);
        }
        return;
    }
});

// ============================================================================
// STARTUP MESSAGE
// ============================================================================
system.runTimeout(() => {
    try {
        world.sendMessage("§d§l[Mob Enchant]§r §aAddon loaded! Mobs now have a 1/6 chance to spawn enchanted.");
        world.sendMessage("§d§l[Mob Enchant]§r §7Type §e/scriptevent mobenchant:help§7 for manual enchanting commands.");
    } catch {
        // May fail if no players are online yet
    }
}, 100);


