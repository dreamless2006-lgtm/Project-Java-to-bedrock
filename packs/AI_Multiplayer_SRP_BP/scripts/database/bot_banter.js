// Bot-to-bot conversation content. Placeholders: {to} = name of the bot being
// addressed, {noun} = thing picked out of what they said.

export const TOPIC_NOUNS = {
    combat: ["zombie", "skeleton", "creeper", "spider", "that mob", "the fight"],
    gathering: ["iron", "diamond", "copper", "some ore", "a good haul"],
    building: ["a wall", "a roof", "my little base", "a bridge", "a dirt tower"],
    exploration: ["a cave", "a ravine", "a village", "somewhere new", "a long corridor"],
    social: ["nothing much", "the same old thing", "a pretty normal day"],
    playful: ["that", "it", "the whole thing"],
    trouble: ["water", "a hole", "a cliff", "a stupid gap"]
};

export const REPLIES = {
    combat: {
        ally: [
            "nice one {to}, that one looked mean",
            "{to} need me to come over?",
            "that's my duet partner right there",
            "gg {to}, clean finish",
            "told you {noun} would rush me too"
        ],
        rival: [
            "{to} only won because I was busy",
            "took you long enough {to}",
            "don't need your help, {noun} scared you worse",
            "{to} is bragging about {noun} now, classic"
        ],
        neutral: [
            "yeah {noun} keeps finding me",
            "{to} careful, more spawn at night",
            "I lost half my health to one of those",
            "sounds rough {to}"
        ]
    },
    gathering: {
        ally: [
            "share some {noun} {to}?",
            "I'm still stuck on stone tools, jealous {to}",
            "nice {noun}! where did you find it",
            "{to} save me a piece of {noun} please"
        ],
        rival: [
            "{to} found {noun}? took you forever",
            "I dug way more {noun} than you, sorry",
            "keep it, I have {noun} already. lied, come back"
        ],
        neutral: [
            "there's more {noun} near the ravine",
            "I always run out of {noun}",
            "lucky {to}, I only got cobble today"
        ]
    },
    building: {
        ally: [
            "{to} your build looks actually good",
            "can I sleep at your place tonight {to}?",
            "teach me to build like that {to}",
            "mine is just a hole in the wall, no judgement"
        ],
        rival: [
            "{to} that looks like a dirt box",
            "I would have built it better, obviously",
            "nobody asked you to build next to me {to}"
        ],
        neutral: [
            "I should build something too",
            "roofs are hard, no cap",
            "{to} needs a roof though, honestly"
        ]
    },
    exploration: {
        ally: [
            "{to} take me next time, I'm bored",
            "a cave? I fell in one last week, no thanks",
            "mark that spot {to}, I'll come look"
        ],
        rival: [
            "I found that first {to}",
            "{to} got lost again didn't you",
            "exploring is just dying slower"
        ],
        neutral: [
            "I keep walking in circles out here",
            "careful near edges, I almost fell twice",
            "sounds nice, I've been mining all day"
        ]
    },
    social: {
        ally: [
            "hey {to}, good to see you out here",
            "yo {to}",
            "you're the only one I talk to honestly",
            "same old {to}, same old"
        ],
        rival: [
            "what do you want {to}",
            "don't get too friendly with me",
            "hm. hi I guess {to}"
        ],
        neutral: [
            "hey {to}",
            "how's it going",
            "quiet day out here",
            "you good?"
        ]
    },
    playful: {
        ally: [
            "lmao {to} stop",
            "no cap that was funny",
            "{to} you're weird, I like it",
            "haha okay that one got me"
        ],
        rival: [
            "that wasn't funny {to}",
            "I'm not laughing, you're laughing",
            "classic {to}, joking to hide the loss"
        ],
        neutral: [
            "haha yeah",
            "haha legit",
            "{to} has jokes today"
        ]
    },
    trouble: {
        ally: [
            "{to} get out, stand on the blocks not in it",
            "I was in {noun} like ten minutes ago, I feel you",
            "want me to wait for you {to}?",
            "just swim to the edge, it helps, mostly"
        ],
        rival: [
            "{to} stuck in {noun}? embarrassing",
            "I fell in {noun} once too, don't worry about it",
            "maybe watch where you walk {to}"
        ],
        neutral: [
            "hate {noun}, can't see anything in it",
            "I keep ending up in {noun}",
            "get somewhere dry {to}"
        ]
    }
};

// Small mood flavour appended or prepended to a reply.
export const MOOD_FLAVOUR = {
    happy: [" feeling great today", " haha", " honestly best day"],
    angry: [" ugh", " not now", " I'm busy"],
    scared: [" please don't leave me", " this is scary", " stay close"],
    wounded: [" I'm dying here", " so hurt", " need food"],
    neutral: ["", "", ""]
};

// Bots start topics from their own state so conversations aren't only reactions.
export const OPENERS = {
    mining: [
        "been digging forever, found nothing good",
        "anyone else hitting iron up here?",
        "I'm going to run out of torches soon"
    ],
    building: [
        "almost done with my build, don't look at it yet",
        "needs a roof, it always needs a roof",
        "I keep placing blocks in the wrong spot"
    ],
    exploring: [
        "walking the ridge, it's actually pretty out here",
        "found a nice spot, I'll show you later",
        "I don't remember how I got here"
    ],
    idle: [
        "nothing to do, anyone want to go mining?",
        "just standing around out here",
        "what are you doing {to}?"
    ],
    wounded: [
        "I'm low, someone stick with me",
        "that hurt more than I expected",
        "gotta eat something soon"
    ],
    scared: [
        "it's dark and I don't like it",
        "I heard something over there",
        "staying near the light tonight"
    ],
    night: [
        "too many mobs out at night",
        "I can barely see, who lit this moon",
        "sleep soon or die trying"
    ],
    rain: [
        "rain again, my torches keep dying",
        "hate the rain, everything slides",
        "at least the weather keeps me company"
    ]
};

export const WATER_COMPLAINTS = [
    "I'm in the water again, can't get out",
    "this bank is too high, hold on",
    "ugh I keep slipping back in",
    "someone help me out of here",
    "I can't swim worth anything"
];

export const WATER_RELIEF = [
    "okay I'm out, that was rough",
    "dry land, finally",
    "never swimming first again"
];

export const DROWNING_ALERTS = [
    "I can't breathe in here!!",
    "getting no air, seriously stuck"
];

// Talking to himself - no listener needed, which is most of what a real player
// does on a quiet server. {i} = item, {n} = count
export const SELF_TALK = {
    danger: [
        "something's over here, I can hear it",
        "not going over there, I'm not stupid",
        "I remember getting wrecked in this spot",
        "alright, who's there"
    ],
    hunting: [
        "come here you", "this one's mine", "easy xp",
        "just a bit closer, come on", "got you this time"
    ],
    hurt: [
        "that's going to leave a mark", "need to heal before I do anything else",
        "I'm one hit from respawning", "why do I always end up like this"
    ],
    hungry: [
        "I'm starving, got nothing to eat", "my food bar is gone",
        "would give anything for a steak right now"
    ],
    night: [
        "should have built a base by now", "it's dark and I'm out in the open",
        "night's the worst part of this game", "I'm not going anywhere without a torch"
    ],
    found: [
        "{n} {i}, that's a decent haul", "ooh, {i}",
        "getting rich on {i} honestly", "I'm going to need a bigger inventory for this {i}"
    ],
    working: [
        "one more tree then I'm done", "this staircase is going nowhere",
        "I've been digging for ages", "just need a bit more"
    ],
    bored: [
        "nothing happening today", "I've walked past this tree four times",
        "what do I even do with my time", "is anyone even on",
        "starting to talk to myself, great sign"
    ],
    mutter: [
        "hmm", "alright, where was I", "I should really sort my inventory",
        "this place is alright actually", "wonder if anyone's listening to me talk"
    ]
};
