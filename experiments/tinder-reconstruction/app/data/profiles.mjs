// Fictional profiles for the reconstruction. Photos are generated placeholder
// art, not real people. Field shapes mirror the observed Tinder `User` and
// recommendation result schemas in ../evidence/api-contract.json.

export const VIEWER = {
  id: "u_viewer",
  name: "Alex",
  age: 27,
  gender: 1,
  city: "Harare",
  neighborhood: "Avondale",
  bio: "Building things at night, chasing sunlight by day. Ask me about the last road trip.",
  job: "Product designer",
  school: "University of Zimbabwe",
  photo: "/img/you.jpg",
  interests: ["Design", "Road trips", "Coffee", "Vinyl", "Hiking"],
};

export const PROFILES = [
  {
    id: "u_tariro",
    name: "Tariro",
    age: 26,
    gender: 1,
    city: "Harare",
    neighborhood: "Borrowdale",
    distance_mi: 2,
    verified: true,
    activeNow: true,
    job: "Photographer",
    school: "Rhodes University",
    bio: "Film photographer. I will absolutely make you wake up at 5am for golden hour.",
    interests: [
      "Film photography",
      "Golden hour",
      "Road trips",
      "Sadza",
      "Afrobeats",
    ],
    prompts: [
      {
        prompt: "The way to win me over is",
        answer: "let me take one (1) photo of you without complaining.",
      },
      {
        prompt: "My most controversial opinion",
        answer: "Film grain is a personality trait.",
      },
    ],
    photos: [
      { src: "/img/tariro.jpg", alt: "Illustrated portrait of Tariro" },
      { src: "/img/life-hike.svg", alt: "Sunrise over a hiking trail" },
      {
        src: "/img/life-coffee.svg",
        alt: "Coffee and a notebook on a café table",
      },
    ],
    likesYou: false,
  },
  {
    id: "u_nyasha",
    name: "Nyasha",
    age: 28,
    gender: 1,
    city: "Harare",
    neighborhood: "Avondale",
    distance_mi: 4,
    verified: true,
    activeNow: false,
    job: "Architect",
    school: "UCT",
    bio: "I design buildings and pretend my plants don't hate me. Sunday markets >>> brunch.",
    interests: ["Architecture", "Plants", "Markets", "Jazz", "Ceramics"],
    prompts: [
      {
        prompt: "Two truths and a lie",
        answer: "I've been to 14 countries, I can't swim, I make a mean curry.",
      },
      {
        prompt: "Dating me is like",
        answer:
          "a well-lit open-plan apartment: warm, slightly chaotic, good playlist.",
      },
    ],
    photos: [
      { src: "/img/nyasha.jpg", alt: "Illustrated portrait of Nyasha" },
      { src: "/img/life-coffee.svg", alt: "Café table" },
    ],
    likesYou: true,
  },
  {
    id: "u_kudzai",
    name: "Kudzai",
    age: 25,
    gender: 1,
    city: "Harare",
    neighborhood: "Mount Pleasant",
    distance_mi: 3,
    verified: false,
    activeNow: true,
    job: "Nurse",
    school: "UZ",
    bio: "Night shifts, day dreams. I bake when I'm stressed so the ward gets a lot of cookies.",
    interests: ["Baking", "Podcasts", "Netball", "Sunsets", "Dogs"],
    prompts: [
      {
        prompt: "I'm looking for",
        answer: "someone who texts back and knows a good takeaway spot.",
      },
      {
        prompt: "My simple pleasures",
        answer:
          "A quiet Sunday, fresh bread, and a dog that likes me more than you.",
      },
    ],
    photos: [
      { src: "/img/kudzai.jpg", alt: "Illustrated portrait of Kudzai" },
      { src: "/img/life-vinyl.svg", alt: "Vinyl records" },
    ],
    likesYou: false,
  },
  {
    id: "u_rudo",
    name: "Rudo",
    age: 30,
    gender: 1,
    city: "Harare",
    neighborhood: "Belgravia",
    distance_mi: 6,
    verified: true,
    activeNow: false,
    job: "Founder",
    school: "Wits",
    bio: "I run a small logistics company and a large group chat. Equal parts ambition and nonsense.",
    interests: ["Entrepreneurship", "Wine", "Travel", "Live music", "Running"],
    prompts: [
      {
        prompt: "We'll get along if",
        answer:
          "you have opinions about where to eat and no opinions about my calendar.",
      },
      {
        prompt: "My love language is",
        answer: "planes, trains and unreasonable itinerary planning.",
      },
    ],
    photos: [
      { src: "/img/rudo.jpg", alt: "Illustrated portrait of Rudo" },
      { src: "/img/life-coffee.svg", alt: "Coffee cup" },
    ],
    likesYou: true,
  },
  {
    id: "u_tanaka",
    name: "Tanaka",
    age: 29,
    gender: 0,
    city: "Bulawayo",
    neighborhood: "Hillside",
    distance_mi: 271,
    verified: false,
    activeNow: true,
    job: "Musician",
    school: "MSU",
    bio: "Bassist. Bulawayo by way of everywhere. I will send you songs at 2am and expect notes.",
    interests: ["Music", "Vinyl", "Poetry", "Basketball", "Braai"],
    prompts: [
      {
        prompt: "My most controversial opinion",
        answer: "The remix is usually better.",
      },
      {
        prompt: "A shower thought I recently had",
        answer: "Every band is a group project that survived.",
      },
    ],
    photos: [
      { src: "/img/tanaka.jpg", alt: "Illustrated portrait of Tanaka" },
      { src: "/img/life-vinyl.svg", alt: "Record crate" },
    ],
    likesYou: false,
  },
  {
    id: "u_farai",
    name: "Farai",
    age: 27,
    gender: 0,
    city: "Harare",
    neighborhood: "Chitungwiza",
    distance_mi: 12,
    verified: true,
    activeNow: false,
    job: "Teacher",
    school: "UZ",
    bio: "History teacher, weekend cyclist. If I'm not marking, I'm somewhere on a bicycle.",
    interests: ["Cycling", "History", "Books", "Chess", "Hiking"],
    prompts: [
      {
        prompt: "The way to win me over is",
        answer:
          "bring snacks to the ride. I'm not proud of how well that works.",
      },
      {
        prompt: "I'm weirdly attracted to",
        answer: "good handwriting and better questions.",
      },
    ],
    photos: [
      { src: "/img/farai.jpg", alt: "Illustrated portrait of Farai" },
      { src: "/img/life-hike.svg", alt: "Trail through hills" },
    ],
    likesYou: true,
  },
  {
    id: "u_simba",
    name: "Simba",
    age: 31,
    gender: 0,
    city: "Harare",
    neighborhood: "Borrowdale",
    distance_mi: 7,
    verified: true,
    activeNow: false,
    job: "Chef",
    school: "Culinary school",
    bio: "Chef. I cook for strangers all week, so you'd better be interesting at dinner.",
    interests: ["Cooking", "Fitness", "Rugby", "Whisky", "Markets"],
    prompts: [
      {
        prompt: "My simple pleasures",
        answer: "A sharp knife, a quiet kitchen, and a good playlist.",
      },
      {
        prompt: "We'll get along if",
        answer: "you're honest about what you like to eat.",
      },
    ],
    photos: [
      { src: "/img/simba.jpg", alt: "Illustrated portrait of Simba" },
      { src: "/img/life-coffee.svg", alt: "Plated food and coffee" },
    ],
    likesYou: false,
  },
  {
    id: "u_zanele",
    name: "Zanele",
    age: 26,
    gender: 1,
    city: "Harare",
    neighborhood: "Chisipite",
    distance_mi: 8,
    verified: false,
    activeNow: true,
    job: "Veterinarian",
    school: "Wits",
    bio: "Vet. I have three dogs and a strict no-littering policy on dates.",
    interests: ["Animals", "Hiking", "Photography", "Trivia", "R&B"],
    prompts: [
      {
        prompt: "My love language is",
        answer: "texting you a photo of the dog I'm treating.",
      },
      {
        prompt: "Two truths and a lie",
        answer:
          "I've delivered a calf, I hate camping, I can recite the 2010 World Cup squad.",
      },
    ],
    photos: [
      { src: "/img/zanele.jpg", alt: "Illustrated portrait of Zanele" },
      { src: "/img/life-hike.svg", alt: "Hills at dusk" },
    ],
    likesYou: true,
  },
  {
    id: "u_makanaka",
    name: "Makanaka",
    age: 24,
    gender: 1,
    city: "Harare",
    neighborhood: "Greendale",
    distance_mi: 9,
    verified: true,
    activeNow: false,
    job: "UX designer",
    school: "UCT",
    bio: "Designer who can't decide between two fonts. I will redesign this app while we speak.",
    interests: ["Design", "Typography", "Anime", "Matcha", "Thrifting"],
    prompts: [
      {
        prompt: "I geek out on",
        answer: "grids. Kerning. The specific blue of a link.",
      },
      {
        prompt: "Dating me is like",
        answer:
          "a prototype: fast, opinionated, and slightly better every week.",
      },
    ],
    photos: [
      { src: "/img/makanaka.jpg", alt: "Illustrated portrait of Makanaka" },
      { src: "/img/life-vinyl.svg", alt: "Vinyl and posters" },
    ],
    likesYou: false,
  },
  {
    id: "u_tinashe",
    name: "Tinashe",
    age: 26,
    gender: 0,
    city: "Harare",
    neighborhood: "Hatfield",
    distance_mi: 6,
    verified: false,
    activeNow: true,
    job: "Accountant",
    school: "UZ",
    bio: "Numbers by day, stand-up open mics by night. My jokes are better than my spreadsheets.",
    interests: ["Comedy", "Football", "Podcasts", "Coffee", "Board games"],
    prompts: [
      { prompt: "My most controversial opinion", answer: "Cereal is soup." },
      { prompt: "I'm looking for", answer: "someone to roast me with love." },
    ],
    photos: [
      {
        src: "/img/tinashe.svg",
        alt: "Open-mic stage with a microphone and coffee",
      },
      { src: "/img/life-vinyl.svg", alt: "Records in warm light" },
    ],
    likesYou: true,
  },
];

export const SEEDED_MATCHES = [
  {
    profileId: "u_tariro",
    isSuperLike: false,
    isBoostMatch: false,
    daysAgo: 3,
    seen: true,
    messages: [
      {
        from: "them",
        text: "Your bio made me laugh. Golden hour or blue hour?",
        minutesAgo: 190,
      },
      {
        from: "me",
        text: "Golden hour. Blue hour is just golden hour with commitment issues.",
        minutesAgo: 182,
      },
      {
        from: "them",
        text: "Okay that's a good line. I'm stealing it for my next caption.",
        minutesAgo: 140,
      },
    ],
  },
  {
    profileId: "u_simba",
    isSuperLike: true,
    isBoostMatch: true,
    daysAgo: 1,
    seen: false,
    messages: [
      { from: "them", text: "Super like? Bold. I respect it.", minutesAgo: 26 },
    ],
  },
];

export const AUTO_REPLIES = [
  "Okay that's actually a good answer.",
  "Ha. You're funnier than my last three matches combined.",
  "I'm listening. Continue.",
  "This is going suspiciously well.",
  "Tell me something that isn't on your profile.",
  "I was going to play it cool but I'm not going to.",
  "Deal. But I'm choosing the restaurant.",
  "You're going to have to explain that one.",
];

export const LOCATIONS = [
  { name: "Harare", lat: -17.8252, lon: 31.0335 },
  { name: "Bulawayo", lat: -20.1325, lon: 28.6265 },
  { name: "Victoria Falls", lat: -17.9243, lon: 25.8572 },
  { name: "Cape Town", lat: -33.9249, lon: 18.4241 },
  { name: "Nairobi", lat: -1.2921, lon: 36.8219 },
  { name: "London", lat: 51.5074, lon: -0.1278 },
  { name: "Lisbon", lat: 38.7223, lon: -9.1393 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
];
