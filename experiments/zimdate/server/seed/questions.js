/**
 * ZimDate question bank — 60 original questions, 8 categories.
 *
 * These are written for this project. Nothing here is copied from OkCupid's question bank; the
 * *mechanics* (answer / acceptable answers / importance) follow the reverse-engineering dossier in
 * ../../REVERSE_ENGINEERING.md §3, but the wording, framing and options are our own and are aimed at
 * Zimbabwean users (lobola, extended family, mobile money, Shona/Ndebele, load-shedding, diaspora).
 *
 * Design rules the bank is held to:
 *   - every question must be able to *reject*: at least two options that a reasonable person would
 *     not accept from a partner
 *   - no question may have a single socially-correct answer (those carry no information)
 *   - options are short enough to render as chips on a 360px phone
 *   - `weightHint` is guidance for onboarding, never a default we silently apply
 */

/** @typedef {{id: string, label: string}} Option */
/** @typedef {{id: string, category: string, text: string, options: Option[], weightHint: string}} Question */

/** @type {readonly Question[]} */
export const QUESTIONS = Object.freeze(
  [
    {
      id: 'values_kindness',
      category: 'values',
      text: 'Someone is rude to a waiter on a date. Your honest read?',
      options: [
        { id: 'a', label: 'It tells me everything about them' },
        { id: 'b', label: 'Everyone has bad days' },
        { id: 'c', label: 'I would probably not notice' },
        { id: 'd', label: 'I would say something to them right there' },
      ],
      weightHint: 'People tend to mark this very important',
    },
    {
      id: 'values_honesty',
      category: 'values',
      text: 'A small lie that protects a partner\u2019s feelings is\u2026',
      options: [
        { id: 'a', label: 'Sometimes kinder than the truth' },
        { id: 'b', label: 'Never acceptable, however small' },
        { id: 'c', label: 'Fine if it is about small things' },
      ],
      weightHint: 'A dealbreaker for many',
    },
    {
      id: 'values_family_money',
      category: 'values',
      text: 'Your extended family needs money and your household budget is tight.',
      options: [
        { id: 'a', label: 'Family comes first, always' },
        { id: 'b', label: 'We give what we can spare' },
        { id: 'c', label: 'We protect the household first' },
        { id: 'd', label: 'Depends who is asking' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'values_success',
      category: 'values',
      text: 'What gets a person ahead in Zimbabwe?',
      options: [
        { id: 'a', label: 'Hard work and consistency' },
        { id: 'b', label: 'Connections and who you know' },
        { id: 'c', label: 'Luck and timing' },
        { id: 'd', label: 'A mix of all three' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'values_politics',
      category: 'values',
      text: 'How much does a partner\u2019s politics matter to you?',
      options: [
        { id: 'a', label: 'We must broadly agree' },
        { id: 'b', label: 'I can love someone who votes differently' },
        { id: 'c', label: 'Politics should stay out of relationships' },
      ],
      weightHint: 'Very important for some',
    },
    {
      id: 'values_roles',
      category: 'values',
      text: 'Household roles should be\u2026',
      options: [
        { id: 'a', label: 'Shared and negotiated' },
        { id: 'b', label: 'Mostly traditional' },
        { id: 'c', label: 'Whoever earns less does more at home' },
        { id: 'd', label: 'Whatever works that week' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'values_corruption',
      category: 'values',
      text: 'A shortcut needs a \u201cfacilitation fee\u201d to go through.',
      options: [
        { id: 'a', label: 'Refuse, even if it costs me' },
        { id: 'b', label: 'Pay it if my family depends on it' },
        { id: 'c', label: 'It is just how things work' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'values_community',
      category: 'values',
      text: 'I want a partner who is active in their community or church.',
      options: [
        { id: 'a', label: 'Yes, that matters to me' },
        { id: 'b', label: 'Nice but not required' },
        { id: 'c', label: 'I would rather keep to ourselves' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'values_loyalty',
      category: 'values',
      text: 'Your partner and your mother disagree. You\u2026',
      options: [
        { id: 'a', label: 'Back my partner in public, talk privately' },
        { id: 'b', label: 'Stay out of it' },
        { id: 'c', label: 'Respect my mother, she raised me' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'values_second_chance',
      category: 'values',
      text: 'Someone cheated once and confessed immediately.',
      options: [
        { id: 'a', label: 'That can be rebuilt with work' },
        { id: 'b', label: 'Cheating is the end' },
        { id: 'c', label: 'Depends on how long we had been together' },
      ],
      weightHint: 'Mandatory for many',
    },
    {
      id: 'life_morning',
      category: 'lifestyle',
      text: 'Morning person or night person?',
      options: [
        { id: 'a', label: 'Up before the sun' },
        { id: 'b', label: 'Alive after 9pm' },
        { id: 'c', label: 'Both, badly' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'life_fitness',
      category: 'lifestyle',
      text: 'How active are you?',
      options: [
        { id: 'a', label: 'Gym or sport most days' },
        { id: 'b', label: 'A few times a week' },
        { id: 'c', label: 'Walking is my exercise' },
        { id: 'd', label: 'My body is a temple, my temple is closed' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'life_diet',
      category: 'lifestyle',
      text: 'Your diet?',
      options: [
        { id: 'a', label: 'Omnivore, sadza is life' },
        { id: 'b', label: 'Vegetarian' },
        { id: 'c', label: 'Vegan' },
        { id: 'd', label: 'Trying to eat better' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'life_alcohol',
      category: 'lifestyle',
      text: 'Drinking?',
      options: [
        { id: 'a', label: 'Never' },
        { id: 'b', label: 'Socially, a few drinks' },
        { id: 'c', label: 'Most weekends' },
        { id: 'd', label: 'Working on cutting down' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'life_smoking',
      category: 'lifestyle',
      text: 'Smoking?',
      options: [
        { id: 'a', label: 'Never' },
        { id: 'b', label: 'Occasionally' },
        { id: 'c', label: 'Daily' },
        { id: 'd', label: 'Quitting' },
      ],
      weightHint: 'Very important for some',
    },
    {
      id: 'life_cannabis',
      category: 'lifestyle',
      text: 'Cannabis?',
      options: [
        { id: 'a', label: 'Never' },
        { id: 'b', label: 'Occasionally' },
        { id: 'c', label: 'Regularly' },
      ],
      weightHint: 'Mandatory for some',
    },
    {
      id: 'life_travel',
      category: 'lifestyle',
      text: 'How often do you want to travel?',
      options: [
        { id: 'a', label: 'A few times a year' },
        { id: 'b', label: 'Once a year is plenty' },
        { id: 'c', label: 'I am a homebody' },
        { id: 'd', label: 'I want to live abroad' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'life_settle',
      category: 'lifestyle',
      text: 'Where do you want to build a home?',
      options: [
        { id: 'a', label: 'Harare' },
        { id: 'b', label: 'Bulawayo' },
        { id: 'c', label: 'Another Zimbabwean city' },
        { id: 'd', label: 'The diaspora' },
        { id: 'e', label: 'Wherever love takes me' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'love_texting',
      category: 'love',
      text: 'How much texting do you want in a relationship?',
      options: [
        { id: 'a', label: 'Good morning and goodnight, always' },
        { id: 'b', label: 'A few times a day' },
        { id: 'c', label: 'Only to plan things' },
        { id: 'd', label: 'Calls, not texts' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'love_pace',
      category: 'love',
      text: 'How fast do you like to become exclusive?',
      options: [
        { id: 'a', label: 'Within a few dates' },
        { id: 'b', label: 'After a month or two' },
        { id: 'c', label: 'When it is obvious, no timeline' },
        { id: 'd', label: 'I do not rush labels' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'love_language',
      category: 'love',
      text: 'What makes you feel loved most?',
      options: [
        { id: 'a', label: 'Words' },
        { id: 'b', label: 'Time together' },
        { id: 'c', label: 'Help with things' },
        { id: 'd', label: 'Touch' },
        { id: 'e', label: 'Gifts' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'love_conflict',
      category: 'love',
      text: 'In an argument, you need\u2026',
      options: [
        { id: 'a', label: 'To resolve it before sleeping' },
        { id: 'b', label: 'Space first, talk later' },
        { id: 'c', label: 'To be persuaded, not managed' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'love_space',
      category: 'love',
      text: 'Alone time in a relationship is\u2026',
      options: [
        { id: 'a', label: 'Essential, I need my own world' },
        { id: 'b', label: 'Nice, but we do most things together' },
        { id: 'c', label: 'I prefer we are always together' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'love_jealousy',
      category: 'love',
      text: 'Is a little jealousy healthy?',
      options: [
        { id: 'a', label: 'Yes, it shows you care' },
        { id: 'b', label: 'No, it is insecurity' },
        { id: 'c', label: 'It depends how it is expressed' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'love_distance',
      category: 'love',
      text: 'Would you do long distance (Harare\u2013Joburg, or overseas)?',
      options: [
        { id: 'a', label: 'Yes, if there is a plan to close it' },
        { id: 'b', label: 'Only briefly' },
        { id: 'c', label: 'No, I need presence' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'love_pda',
      category: 'love',
      text: 'Public affection?',
      options: [
        { id: 'a', label: 'Hand-holding, yes' },
        { id: 'b', label: 'Keep it private in public' },
        { id: 'c', label: 'I am proudly affectionate' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'culture_language',
      category: 'culture',
      text: 'How important is it that a partner speaks your home language?',
      options: [
        { id: 'a', label: 'Very, language is intimacy' },
        { id: 'b', label: 'I would like them to learn' },
        { id: 'c', label: 'Not important at all' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'culture_lobola',
      category: 'culture',
      text: 'Lobola in 2026?',
      options: [
        { id: 'a', label: 'Important, it honours our families' },
        { id: 'b', label: 'Fine, but it should not bankrupt anyone' },
        { id: 'c', label: 'Outdated' },
        { id: 'd', label: 'It is between the families, not me' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'culture_ceremony',
      category: 'culture',
      text: 'Traditional ceremonies in your life?',
      options: [
        { id: 'a', label: 'We keep them, they matter' },
        { id: 'b', label: 'I attend but it is not my thing' },
        { id: 'c', label: 'I would rather skip them' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'culture_music',
      category: 'culture',
      text: 'What is on your playlist?',
      options: [
        { id: 'a', label: 'Zimdancehall' },
        { id: 'b', label: 'Sungura' },
        { id: 'c', label: 'Amapiano and Afrobeats' },
        { id: 'd', label: 'Gospel' },
        { id: 'e', label: 'Hip hop and R&B' },
        { id: 'f', label: 'Something older than both of us' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'culture_food',
      category: 'culture',
      text: 'Sadza how many times a week?',
      options: [
        { id: 'a', label: 'Daily, obviously' },
        { id: 'b', label: 'A few times a week' },
        { id: 'c', label: 'Once in a while' },
        { id: 'd', label: 'I am the one cooking it' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'culture_tribe',
      category: 'culture',
      text: 'Dating across Shona, Ndebele, or other lines?',
      options: [
        { id: 'a', label: 'No issue at all' },
        { id: 'b', label: 'My family would have opinions' },
        { id: 'c', label: 'I would prefer my own' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'culture_socials',
      category: 'culture',
      text: 'Posting a partner on social media?',
      options: [
        { id: 'a', label: 'Yes, I want the world to know' },
        { id: 'b', label: 'Occasionally, on anniversaries' },
        { id: 'c', label: 'Never, our life is ours' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'family_kids',
      category: 'family',
      text: 'Children?',
      options: [
        { id: 'a', label: 'Want them' },
        { id: 'b', label: 'Do not want them' },
        { id: 'c', label: 'Open, but not soon' },
        { id: 'd', label: 'Already have them and I am done' },
      ],
      weightHint: 'Mandatory',
    },
    {
      id: 'family_timing',
      category: 'family',
      text: 'If children are on the table, when?',
      options: [
        { id: 'a', label: 'Within two years' },
        { id: 'b', label: 'After marriage' },
        { id: 'c', label: 'Later, once we are settled' },
        { id: 'd', label: 'Not applicable' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'family_size',
      category: 'family',
      text: 'Ideal family size?',
      options: [
        { id: 'a', label: 'Two or fewer' },
        { id: 'b', label: 'Three or four' },
        { id: 'c', label: 'As many as we are blessed with' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'family_single_parent',
      category: 'family',
      text: 'Dating someone who already has a child?',
      options: [
        { id: 'a', label: 'Completely fine' },
        { id: 'b', label: 'Fine, but I would want to be sure' },
        { id: 'c', label: 'Not for me' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'family_extended',
      category: 'family',
      text: 'Living with extended family after marriage?',
      options: [
        { id: 'a', label: 'Expected and welcome' },
        { id: 'b', label: 'Only temporarily' },
        { id: 'c', label: 'Our own household, always' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'family_pets',
      category: 'family',
      text: 'Pets in the house?',
      options: [
        { id: 'a', label: 'Dogs, definitely' },
        { id: 'b', label: 'Cats' },
        { id: 'c', label: 'No animals indoors' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'family_chores',
      category: 'family',
      text: 'Who cooks on a normal weekday?',
      options: [
        { id: 'a', label: 'Whoever gets home first' },
        { id: 'b', label: 'We cook together' },
        { id: 'c', label: 'One of us does most of it' },
        { id: 'd', label: 'We rotate and plan the week' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'faith_importance',
      category: 'faith',
      text: 'How important is faith in your daily life?',
      options: [
        { id: 'a', label: 'Central' },
        { id: 'b', label: 'Important but private' },
        { id: 'c', label: 'Not very' },
        { id: 'd', label: 'Spiritual, not religious' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'faith_attendance',
      category: 'faith',
      text: 'Church, mosque, or neither?',
      options: [
        { id: 'a', label: 'Every week' },
        { id: 'b', label: 'Sometimes' },
        { id: 'c', label: 'Only for special occasions' },
        { id: 'd', label: 'Never' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'faith_interfaith',
      category: 'faith',
      text: 'Marrying someone of another faith?',
      options: [
        { id: 'a', label: 'No problem, we would find a way' },
        { id: 'b', label: 'Only if we agree on how children are raised' },
        { id: 'c', label: 'Not for me' },
      ],
      weightHint: 'Mandatory for some',
    },
    {
      id: 'faith_prayer',
      category: 'faith',
      text: 'Praying together as a couple?',
      options: [
        { id: 'a', label: 'Daily' },
        { id: 'b', label: 'When we need it' },
        { id: 'c', label: 'It is personal, not shared' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'faith_tradition',
      category: 'faith',
      text: 'Traditional beliefs alongside faith?',
      options: [
        { id: 'a', label: 'They can coexist' },
        { id: 'b', label: 'I keep only one' },
        { id: 'c', label: 'My family keeps them, I stay out of it' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'faith_afterlife',
      category: 'faith',
      text: 'What happens after we die?',
      options: [
        { id: 'a', label: 'Heaven or judgement, as taught' },
        { id: 'b', label: 'We return to the ancestors' },
        { id: 'c', label: 'Nobody knows and that is fine' },
        { id: 'd', label: 'I would rather not think about it' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'money_saving',
      category: 'money',
      text: 'Saver or spender?',
      options: [
        { id: 'a', label: 'Saver, I track everything' },
        { id: 'b', label: 'Balanced' },
        { id: 'c', label: 'Spender, I enjoy now' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'money_share',
      category: 'money',
      text: 'Finances in a marriage?',
      options: [
        { id: 'a', label: 'One shared pot' },
        { id: 'b', label: 'Separate accounts, shared bills' },
        { id: 'c', label: 'Mixed, with our own savings' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'money_ambition',
      category: 'money',
      text: 'Ambition?',
      options: [
        { id: 'a', label: 'I work hard to grow' },
        { id: 'b', label: 'I value stability over climbing' },
        { id: 'c', label: 'I am building something of my own' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'money_debt',
      category: 'money',
      text: 'You find out a partner has a loan they never mentioned.',
      options: [
        { id: 'a', label: 'The lie is worse than the debt' },
        { id: 'b', label: 'We deal with it together' },
        { id: 'c', label: 'Their money, their business' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'money_support',
      category: 'money',
      text: 'Supporting parents or siblings financially is\u2026',
      options: [
        { id: 'a', label: 'A duty, I plan for it' },
        { id: 'b', label: 'A burden I resent' },
        { id: 'c', label: 'Not my responsibility' },
      ],
      weightHint: 'Very important',
    },
    {
      id: 'money_mobile',
      category: 'money',
      text: 'Mobile money in daily life?',
      options: [
        { id: 'a', label: 'EcoCash for everything' },
        { id: 'b', label: 'Cash is still king' },
        { id: 'c', label: 'Card and bank transfer' },
        { id: 'd', label: 'Whatever the vendor accepts' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'money_gifts',
      category: 'money',
      text: 'Gifts in a relationship?',
      options: [
        { id: 'a', label: 'Small things, often' },
        { id: 'b', label: 'One big thing at milestones' },
        { id: 'c', label: 'I care about presence, not presents' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'money_kidschool',
      category: 'money',
      text: 'Private school for children, if the money allows?',
      options: [
        { id: 'a', label: 'Worth every cent' },
        { id: 'b', label: 'Depends on the school' },
        { id: 'c', label: 'Not necessary' },
      ],
      weightHint: 'Somewhat important',
    },
    {
      id: 'fun_weekend',
      category: 'fun',
      text: 'Ideal free weekend?',
      options: [
        { id: 'a', label: 'Road trip out of town' },
        { id: 'b', label: 'Braai with friends' },
        { id: 'c', label: 'Books, series, and silence' },
        { id: 'd', label: 'Live music or a night out' },
        { id: 'e', label: 'Church and family lunch' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'fun_series',
      category: 'fun',
      text: 'When a show hooks you, you\u2026',
      options: [
        { id: 'a', label: 'Binge it in a night' },
        { id: 'b', label: 'Watch one a week' },
        { id: 'c', label: 'Read the book instead' },
      ],
      weightHint: 'Irrelevant is fine here',
    },
    {
      id: 'fun_sport',
      category: 'fun',
      text: 'Sport?',
      options: [
        { id: 'a', label: 'Football, loudly' },
        { id: 'b', label: 'Cricket' },
        { id: 'c', label: 'Rugby' },
        { id: 'd', label: 'Netball or athletics' },
        { id: 'e', label: 'I only watch the highlights' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'fun_reading',
      category: 'fun',
      text: 'Books?',
      options: [
        { id: 'a', label: 'Always reading something' },
        { id: 'b', label: 'A few a year' },
        { id: 'c', label: 'Only audiobooks' },
        { id: 'd', label: 'Not for me' },
      ],
      weightHint: 'A little important',
    },
    {
      id: 'fun_dancing',
      category: 'fun',
      text: 'At a wedding, when the music starts\u2026',
      options: [
        { id: 'a', label: 'I am first on the floor' },
        { id: 'b', label: 'One good song and I am done' },
        { id: 'c', label: 'I hold the drinks' },
      ],
      weightHint: 'Irrelevant is fine here',
    },
    {
      id: 'fun_humour',
      category: 'fun',
      text: 'Type of humour that gets you?',
      options: [
        { id: 'a', label: 'Dry and deadpan' },
        { id: 'b', label: 'Storytelling and exaggeration' },
        { id: 'c', label: 'Teasing and banter' },
        { id: 'd', label: 'Wholesome and silly' },
      ],
      weightHint: 'A little important',
    },
  ].map((question) => Object.freeze({ ...question, options: Object.freeze(question.options.map((option) => Object.freeze(option))) })),
);

/** @type {readonly string[]} */
export const CATEGORIES = Object.freeze(['values', 'lifestyle', 'love', 'culture', 'family', 'faith', 'money', 'fun']);

export const QUESTIONS_BY_ID = Object.freeze(new Map(QUESTIONS.map((question) => [question.id, question])));

export const QUESTION_INDEX = Object.freeze(
  new Map(QUESTIONS.map((question) => [question.id, { category: question.category, text: question.text, options: question.options.map((option) => option.label) }])),
);

export function validateQuestionBank() {
  const problems = [];
  const seen = new Set();
  if (QUESTIONS.length !== 60) problems.push(`expected 60 questions, found ${QUESTIONS.length}`);
  for (const question of QUESTIONS) {
    if (seen.has(question.id)) problems.push(`duplicate question id: ${question.id}`);
    seen.add(question.id);
    if (!CATEGORIES.includes(question.category)) problems.push(`${question.id}: unknown category ${question.category}`);
    if (question.options.length < 2) problems.push(`${question.id}: needs at least two options`);
    const optionIds = new Set(question.options.map((option) => option.id));
    if (optionIds.size !== question.options.length) problems.push(`${question.id}: duplicate option ids`);
    if (question.text.trim().length === 0) problems.push(`${question.id}: empty question text`);
    const labels = new Set(question.options.map((option) => option.label));
    // Short prompts are deliberate ("Smoking?"), but two identical chips are a UX bug.
    if (labels.size !== question.options.length) problems.push(`${question.id}: duplicate option labels`);
  }
  for (const category of CATEGORIES) {
    const count = QUESTIONS.filter((question) => question.category === category).length;
    if (count === 0) problems.push(`category ${category} has no questions`);
  }
  return { ok: problems.length === 0, problems };
}
