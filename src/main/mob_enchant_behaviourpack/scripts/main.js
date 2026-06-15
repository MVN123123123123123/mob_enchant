// ============================================================================
// Mob Enchantment Addon — Minecraft Bedrock 1.26.x Script API
// ============================================================================
// When any entity spawns, rolls a 1-in-6 chance to become "enchanted".
// Enchanted mobs gain 1–5 random positive enchantments with weighted levels.
// Enchantments are stored as dynamic properties and applied via event listeners.
// ============================================================================

import { world, system, EntityDamageCause, ItemStack } from "@minecraft/server";

// ============================================================================
// ENCHANTMENT POOL — All positive vanilla enchantments (no curses)
// ============================================================================
// Each entry: { id, maxLevel, category }
// category is used to decide which effects to implement
const ENCHANTMENT_POOL = [
    // --- Defensive ---
    { id: "protection",            maxLevel: 4, category: "defensive" },
    { id: "projectile_protection", maxLevel: 4, category: "defensive" },
    { id: "fire_protection",       maxLevel: 4, category: "defensive" },
    { id: "blast_protection",      maxLevel: 4, category: "defensive" },
    { id: "feather_falling",       maxLevel: 4, category: "defensive" },
    { id: "thorns",                maxLevel: 3, category: "defensive" },
    { id: "respiration",           maxLevel: 3, category: "passive" },
    { id: "aqua_affinity",         maxLevel: 1, category: "flavor" },

    // --- Movement ---
    { id: "depth_strider",         maxLevel: 3, category: "passive" },
    { id: "frost_walker",          maxLevel: 2, category: "passive" },
    { id: "soul_speed",            maxLevel: 3, category: "passive" },

    // --- Offensive ---
    { id: "sharpness",             maxLevel: 5, category: "offensive" },
    { id: "smite",                 maxLevel: 5, category: "offensive" },
    { id: "bane_of_arthropods",    maxLevel: 5, category: "offensive" },
    { id: "knockback",             maxLevel: 2, category: "offensive" },
    { id: "fire_aspect",           maxLevel: 2, category: "offensive" },
    { id: "looting",               maxLevel: 3, category: "flavor" },

    // --- Tool ---
    { id: "efficiency",            maxLevel: 5, category: "flavor" },
    { id: "fortune",               maxLevel: 3, category: "flavor" },
    { id: "silk_touch",            maxLevel: 1, category: "flavor" },
    { id: "unbreaking",            maxLevel: 3, category: "flavor" },
    { id: "mending",               maxLevel: 1, category: "flavor" },

    // --- Ranged ---
    { id: "power",                 maxLevel: 5, category: "offensive" },
    { id: "punch",                 maxLevel: 2, category: "offensive" },
    { id: "flame",                 maxLevel: 1, category: "offensive" },
    { id: "infinity",              maxLevel: 1, category: "flavor" },
    { id: "multishot",             maxLevel: 1, category: "flavor" },
    { id: "piercing",              maxLevel: 4, category: "flavor" },
    { id: "quick_charge",          maxLevel: 3, category: "flavor" },

    // --- Trident ---
    { id: "impaling",              maxLevel: 5, category: "offensive" },
    { id: "riptide",               maxLevel: 3, category: "flavor" },
    { id: "loyalty",               maxLevel: 3, category: "flavor" },
    { id: "channeling",            maxLevel: 1, category: "offensive" },

    // --- Fishing ---
    { id: "luck_of_the_sea",       maxLevel: 3, category: "flavor" },
    { id: "lure",                  maxLevel: 3, category: "flavor" },
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
    { item: "minecraft:emerald",        weight: 400 },
    { item: "minecraft:iron_ingot",     weight: 290 },
    { item: "minecraft:gold_ingot",     weight: 290 },
    { item: "minecraft:diamond",        weight: 19 },
    { item: "minecraft:netherite_scrap",weight: 1 },
];

// ============================================================================
// DYNAMIC PROPERTY KEY
// ============================================================================
const ENCHANT_PROPERTY = "mob_enchant:enchantments";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
// ENTITY SPAWN HANDLER — The main dice roll
// ============================================================================
world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;

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
                        const power = 0.4 * enchant.level;
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
world.afterEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    const attacker = event.damageSource?.damagingEntity;

    if (!isEntityValid(victim)) return;

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
                    try { dim.runCommand(`give @p[r=24] ${itemId} ${stackSize}`); } catch {}
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
// STARTUP MESSAGE
// ============================================================================
system.runTimeout(() => {
    try {
        world.sendMessage("§d§l[Mob Enchant]§r §aAddon loaded! Mobs now have a 1/6 chance to spawn enchanted.");
    } catch {
        // May fail if no players are online yet
    }
}, 100);
