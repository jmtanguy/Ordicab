/**
 * fakegen — deterministic fake value pools for PII pseudonymization.
 *
 * Values are chosen deterministically from a pool using a hash of the original,
 * so the same original always produces the same fake within a session.
 * Fake values are semantically realistic (real-looking names, addresses, etc.)
 * so the LLM can reason naturally about the pseudonymized text.
 */

export type Locale = 'fr' | 'en'
export type Gender = 'M' | 'F' | null

function simpleHash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function pickFrom<T>(pool: readonly T[], key: string): T {
  return pool[simpleHash(key) % pool.length]!
}

const FIRST_NAMES_FR_M = [
  'Antoine',
  'Pierre',
  'Nicolas',
  'Julien',
  'Maxime',
  'Alexandre',
  'François',
  'Emmanuel',
  'Romain',
  'Christophe',
  'Philippe',
  'Stéphane',
  'Frédéric',
  'Sébastien',
  'Mathieu',
  'Benoît',
  'Olivier',
  'Thierry',
  'Cédric',
  'Guillaume'
] as const
const FIRST_NAMES_FR_F = [
  'Sophie',
  'Marie',
  'Claire',
  'Isabelle',
  'Nathalie',
  'Céline',
  'Valérie',
  'Hélène',
  'Christine',
  'Émilie',
  'Camille',
  'Aurélie',
  'Virginie',
  'Caroline',
  'Sandrine',
  'Véronique',
  'Élodie',
  'Charlotte',
  'Stéphanie',
  'Amélie'
] as const
const FIRST_NAMES_EN_M = [
  'Andrew',
  'James',
  'Michael',
  'William',
  'Joseph',
  'Christopher',
  'Daniel',
  'Matthew',
  'Anthony',
  'Steven',
  'Brian',
  'Jonathan',
  'Kevin',
  'Timothy',
  'Justin',
  'Ryan',
  'Nathan',
  'Benjamin',
  'Samuel',
  'Ethan'
] as const
const FIRST_NAMES_EN_F = [
  'Jennifer',
  'Linda',
  'Barbara',
  'Elizabeth',
  'Susan',
  'Jessica',
  'Sarah',
  'Karen',
  'Lisa',
  'Nancy',
  'Betty',
  'Sandra',
  'Ashley',
  'Dorothy',
  'Kimberly',
  'Emily',
  'Donna',
  'Michelle',
  'Rebecca',
  'Stephanie'
] as const
const LAST_NAMES_FR = [
  'Dubois',
  'Durand',
  'Leroy',
  'Moreau',
  'Lefebvre',
  'Roux',
  'Fournier',
  'Morel',
  'Girard',
  'Mercier',
  'Dupont',
  'Bonnet',
  'Rousseau',
  'Blanc',
  'Chevalier',
  'Garnier',
  'Faure',
  'Perrin',
  'Fontaine',
  'Marchand',
  'Carpentier',
  'Legrand',
  'Meunier',
  'Pelletier',
  'Leclerc',
  'Bouchard',
  'Lacroix',
  'Renard',
  'Aubert',
  'Picard',
  'Tessier',
  'Masson',
  'Barbier',
  'Brunet',
  'Charpentier'
] as const
const LAST_NAMES_EN = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Miller',
  'Davis',
  'Wilson',
  'Moore',
  'Taylor',
  'Anderson',
  'Jackson',
  'White',
  'Harris',
  'Thompson',
  'Walker',
  'Robinson',
  'Clark',
  'Lewis',
  'Hall',
  'Baker',
  'Nelson',
  'Mitchell',
  'Turner',
  'Phillips',
  'Campbell',
  'Parker',
  'Evans',
  'Edwards',
  'Collins'
] as const
const COMPANIES_FR = [
  'Bertrand & Associés',
  'Conseil Pelican',
  'Cabinet Horizon',
  'Services Lumière',
  'Groupe Soleil',
  'Expertise Loire',
  'Conseil Rhône',
  'Bureau Garonne',
  'Solutions Seine',
  'Cabinet Mistral'
] as const
const COMPANIES_EN = [
  'Pelican Partners',
  'Horizon Consulting',
  'Sunrise Advisory',
  'Lakeside Group',
  'Meridian Services',
  'Summit Counsel',
  'Beacon Associates',
  'Clearwater Solutions',
  'Ridgeline Partners',
  'Cascade Consulting'
] as const
const STREETS_FR = [
  'rue des Lilas',
  'avenue du Maréchal Joffre',
  'boulevard des Capucines',
  'impasse du Moulin',
  'rue de la République',
  'avenue Victor Hugo',
  'rue du Faubourg Saint-Antoine',
  'rue des Quatre-Vents',
  'passage de la Bonne Graine',
  'allée des Roses'
] as const
const CITIES_FR = [
  'Lyon',
  'Marseille',
  'Bordeaux',
  'Nantes',
  'Strasbourg',
  'Lille',
  'Rennes',
  'Reims',
  'Toulon',
  'Grenoble'
] as const
const STREETS_EN = [
  'Maple Avenue',
  'Oak Street',
  'Cedar Lane',
  'Birch Road',
  'Elm Drive',
  'Pine Court',
  'Willow Way',
  'Ash Boulevard',
  'Chestnut Path',
  'Walnut Close'
] as const
const CITIES_EN = [
  'Springfield',
  'Greenville',
  'Fairview',
  'Madison',
  'Georgetown',
  'Arlington',
  'Lakewood',
  'Riverside',
  'Maplewood',
  'Hillcrest'
] as const
const JOB_TITLES_FR = [
  'Ingénieur',
  'Médecin',
  'Comptable',
  'Architecte',
  'Pharmacien',
  'Notaire',
  'Expert-comptable',
  'Chirurgien',
  'Directeur commercial',
  'Consultant'
] as const
const JOB_TITLES_EN = [
  'Engineer',
  'Physician',
  'Accountant',
  'Architect',
  'Pharmacist',
  'Financial Advisor',
  'Consultant',
  'Manager',
  'Director',
  'Analyst'
] as const

// Extended gender lookup sets — used by inferGender to detect first names from free text.
// Covers the most common French and English first names beyond the fake pools.
const KNOWN_FEMALE_FR = new Set([
  // Pool names
  'Sophie',
  'Marie',
  'Claire',
  'Isabelle',
  'Nathalie',
  'Céline',
  'Valérie',
  'Hélène',
  'Christine',
  'Émilie',
  'Camille',
  'Aurélie',
  'Virginie',
  'Caroline',
  'Sandrine',
  'Patricia',
  'Laurence',
  'Véronique',
  'Élodie',
  'Charlotte',
  'Stéphanie',
  'Amélie',
  // Classic / baby-boomer generation
  'Anne',
  'Sylvie',
  'Martine',
  'Jacqueline',
  'Monique',
  'Françoise',
  'Brigitte',
  'Michèle',
  'Micheline',
  'Danielle',
  'Chantal',
  'Dominique',
  'Corinne',
  'Agnès',
  'Florence',
  'Catherine',
  'Pascale',
  'Muriel',
  'Nadège',
  'Cécile',
  'Annick',
  'Christelle',
  'Karine',
  'Séverine',
  'Valérie',
  'Mélanie',
  'Amandine',
  'Vanessa',
  'Sonia',
  'Laetitia',
  'Frédérique',
  'Rolande',
  'Ghislaine',
  'Mireille',
  'Josiane',
  'Odile',
  'Régine',
  'Gisèle',
  'Christiane',
  'Andrée',
  'Liliane',
  'Marcelle',
  'Yvette',
  'Louisette',
  'Solange',
  'Denise',
  'Germaine',
  'Hortense',
  'Bernadette',
  'Claudette',
  'Raymonde',
  'Ginette',
  'Eliane',
  'Élianne',
  'Nadine',
  'Sabine',
  'Madeleine',
  'Simone',
  'Odette',
  'Yvonne',
  'Renée',
  'Jeanne',
  'Suzanne',
  'Marguerite',
  'Henriette',
  'Georgette',
  'Thérèse',
  'Colette',
  'Geneviève',
  'Béatrice',
  'Laure',
  // Millennial / Gen Z
  'Julie',
  'Laura',
  'Lucie',
  'Manon',
  'Léa',
  'Emma',
  'Inès',
  'Jade',
  'Clémence',
  'Pauline',
  'Alice',
  'Sarah',
  'Océane',
  'Juliette',
  'Margot',
  'Zoé',
  'Anaïs',
  'Noémie',
  'Mathilde',
  'Élise',
  'Agathe',
  'Lola',
  'Chloé',
  'Maëva',
  'Yasmine',
  'Assia',
  'Fatima',
  'Samira',
  'Leïla',
  'Amina',
  'Naïma',
  'Aïcha',
  'Soraya',
  'Roxane',
  'Mélissa',
  'Alexia',
  'Eloïse',
  'Héloïse',
  'Romane',
  'Tiphaine',
  'Gwenaëlle',
  'Gaëlle',
  'Nolwenn',
  'Maëlle',
  'Morgane',
  'Typhaine',
  'Enora',
  // Classic literary / aristocratic
  'Éléonore',
  'Eléonore',
  'Léonie',
  'Adèle',
  'Céleste',
  'Victoire',
  'Constance',
  'Violette',
  'Rosalie',
  'Estelle',
  'Clotilde',
  'Mathilde',
  'Honorine',
  'Edwige',
  'Blanche',
  'Clémentine',
  'Angélique',
  'Delphine',
  'Sabrina',
  'Véga',
  // Modern trendy
  'Lina',
  'Nina',
  'Mia',
  'Eva',
  'Ava',
  'Ella',
  'Elsa',
  'Anna',
  'Luna',
  'Iris',
  'Rose',
  'Louise',
  'Léonie',
  'Maïa',
  'Tia',
  'Lena',
  'Nora',
  'Zélie',
  'Axelle',
  //
  'Fatima',
  'Nadia',
  'Samira',
  'Leïla',
  'Amina',
  'Naïma',
  'Aïcha',
  'Soraya',
  'Yasmine',
  'Assia',
  'Nour',
  'Rania',
  'Hanane',
  'Malika',
  'Khadija',
  'Houda',
  'Ilham',
  'Imane',
  'Souad',
  'Karima',
  'Wafa',
  'Siham',
  'Zineb',
  'Rachida',
  //
  'Aminata',
  'Mariama',
  'Fatoumata',
  'Kadiatou',
  'Rokiatou',
  'Adja',
  'Binta',
  'Maimouna',
  'Oumou',
  'Coumba',
  'Fanta',
  'Mariam',
  'Ndèye',
  'Astou',
  'Rokhaya',
  //
  'Priya',
  'Anjali',
  'Divya',
  'Kavya',
  'Meera',
  'Pooja',
  'Shreya',
  'Sunita',
  //
  'Ayşe',
  'Fatma',
  'Zeynep',
  'Elif',
  'Emine',
  'Hatice',
  'Gülsüm',
  'Sevgi',
  // Additional names
  'Annabelle',
  'Véronique',
  'Viviane',
  'Joëlle',
  'Marielle',
  'Isabeau',
  'Perrine',
  'Élisabeth',
  'Clémence',
  'Garance',
  'Flavie',
  'Capucine',
  'Salomé',
  'Apolline',
  'Eulalie',
  'Séraphine',
  'Coline',
  'Eléa',
  'Éléa',
  'Emeline',
  'Emmeline',
  'Priscille',
  'Gwladys',
  'Marjorie',
  'Marlène',
  'Rozenn',
  'Sterenn',
  'Armelle',
  'Soizic',
  'Aziliz'
])
const KNOWN_MALE_FR = new Set([
  // Pool names
  'Antoine',
  'Pierre',
  'Thomas',
  'Nicolas',
  'Julien',
  'Maxime',
  'Alexandre',
  'François',
  'Emmanuel',
  'Laurent',
  'Romain',
  'Vincent',
  'Christophe',
  'Philippe',
  'Stéphane',
  'Frédéric',
  'David',
  'Sébastien',
  'Mathieu',
  'Benoît',
  // Classic / baby-boomer generation
  'Jean',
  'Michel',
  'Alain',
  'Bernard',
  'Patrick',
  'Didier',
  'Thierry',
  'Éric',
  'Pascal',
  'Marc',
  'Luc',
  'Paul',
  'Louis',
  'Hervé',
  'Gilles',
  'Xavier',
  'Yves',
  'Claude',
  'Olivier',
  'Patrice',
  'Bruno',
  'Franck',
  'Cédric',
  'Sylvain',
  'Régis',
  'Arnaud',
  'Fabrice',
  'Serge',
  'Damien',
  'Guillaume',
  'Sébastien',
  'Christophe',
  'Henri',
  'René',
  'Roger',
  'Raymond',
  'Marcel',
  'André',
  'Georges',
  'Robert',
  'Jacques',
  'Maurice',
  'Gérard',
  'Gaston',
  'Fernand',
  'Édouard',
  'Armand',
  'Léon',
  'Auguste',
  'Émile',
  'Gustave',
  'Alfred',
  'Albert',
  'Charles',
  'Lucien',
  'Clément',
  'Jérôme',
  'Ludovic',
  'Sébastien',
  'Frédéric',
  'Éric',
  'Florian',
  'Tristan',
  'Quentin',
  'Thibault',
  'Thibaut',
  'Rémi',
  'Rémy',
  'Timothée',
  // Regional / Breton / Basque
  'Loïc',
  'Erwann',
  'Ronan',
  'Yann',
  'Gaël',
  'Tanguy',
  'Corentin',
  'Gurvan',
  'Brendan',
  'Malo',
  'Maël',
  'Kilian',
  'Titouan',
  'Théodore',
  'Augustin',
  // Millennial / Gen Z
  'Kevin',
  'Dylan',
  'Lucas',
  'Hugo',
  'Théo',
  'Nathan',
  'Mathis',
  'Baptiste',
  'Axel',
  'Alexis',
  'Valentin',
  'Raphaël',
  'Gabriel',
  'Arthur',
  'Léo',
  'Tom',
  'Adam',
  'Robin',
  'Enzo',
  'Matteo',
  'Noah',
  'Ethan',
  'Yanis',
  'Kévin',
  'Sacha',
  'Rayan',
  'Mehdi',
  'Karim',
  'Sofiane',
  'Bilal',
  'Ilyes',
  'Nassim',
  'Amine',
  'Samy',
  'Walid',
  'Omar',
  'Hassan',
  'Youssef',
  'Mohamed',
  'Ali',
  // Modern
  'Liam',
  'Noa',
  'Nolan',
  'Ryan',
  'Evan',
  'Eliot',
  'Elio',
  'Aaron',
  'Théo',
  'Edouard',
  'Marius',
  'Camille',
  'Dominique',
  'Pascal',
  // Additional names
  'Anatole',
  'Anselme',
  'Barthélemy',
  'Baudouin',
  'Brice',
  'Clovis',
  'Cyprien',
  'Firmin',
  'Gauthier',
  'Ghislain',
  'Gonzague',
  'Hadrien',
  'Honoré',
  'Hyacinthe',
  'Joris',
  'Kénan',
  'Lazare',
  'Léandre',
  'Lionel',
  'Matthieu',
  'Maxence',
  'Médéric',
  'Nazaire',
  'Odilon',
  'Octave',
  'Pépin',
  'Pierrick',
  'Renaud',
  'Roland',
  'Séraphin',
  'Sylvère',
  'Tancrede',
  'Théophile',
  'Urbain',
  'Vivien',
  'Wilfried',
  //
  'Mohamed',
  'Mehdi',
  'Karim',
  'Sofiane',
  'Bilal',
  'Ilyes',
  'Nassim',
  'Amine',
  'Samy',
  'Walid',
  'Omar',
  'Hassan',
  'Youssef',
  'Ali',
  'Rachid',
  'Samir',
  'Tarik',
  'Nabil',
  'Mourad',
  'Hicham',
  'Aziz',
  'Hamid',
  'Fouad',
  'Adil',
  'Khalid',
  //
  'Mamadou',
  'Ibrahima',
  'Ousmane',
  'Boubacar',
  'Abdoulaye',
  'Cheikh',
  'Modou',
  'Lamine',
  'Seydou',
  'Souleymane',
  'Moussa',
  'Kofi',
  'Kwame',
  'Daouda',
  'Idrissa',
  //
  'Rajan',
  'Arjun',
  'Vikram',
  'Rajesh',
  'Suresh',
  'Amit',
  'Nikhil',
  'Sanjay',
  //
  'Mehmet',
  'Mustafa',
  'Ahmet',
  'Hüseyin',
  'İbrahim',
  'Murat',
  'Emre',
  'Burak'
])
const KNOWN_FEMALE_EN = new Set([
  // Pool names
  'Patricia',
  'Jennifer',
  'Linda',
  'Barbara',
  'Elizabeth',
  'Susan',
  'Jessica',
  'Sarah',
  'Karen',
  'Lisa',
  'Nancy',
  'Betty',
  'Margaret',
  'Sandra',
  'Ashley',
  'Dorothy',
  'Kimberly',
  'Emily',
  'Donna',
  'Michelle',
  'Rebecca',
  'Stephanie',
  // Classic / boomer generation
  'Mary',
  'Helen',
  'Ruth',
  'Sharon',
  'Deborah',
  'Carol',
  'Christine',
  'Virginia',
  'Kathleen',
  'Pamela',
  'Martha',
  'Diane',
  'Julie',
  'Joyce',
  'Victoria',
  'Evelyn',
  'Joan',
  'Carolyn',
  'Catherine',
  'Frances',
  'Ann',
  'Alice',
  'Jean',
  'Judy',
  'Rose',
  'Janet',
  'Amy',
  'Heather',
  'Angela',
  'Rachel',
  'Anna',
  'Laura',
  'Brenda',
  'Cheryl',
  'Diana',
  'Doris',
  'Gloria',
  'Irene',
  'Judith',
  'Marilyn',
  'Norma',
  'Phyllis',
  'Shirley',
  'Theresa',
  'Wanda',
  // Millennial
  'Megan',
  'Amanda',
  'Brittany',
  'Amber',
  'Crystal',
  'Tiffany',
  'Danielle',
  'Kayla',
  'Alexis',
  'Courtney',
  'Taylor',
  'Lauren',
  'Samantha',
  'Alyssa',
  'Natalie',
  'Katie',
  'Molly',
  'Kelsey',
  'Chelsea',
  'Lindsay',
  'Brooke',
  // Gen Z / modern
  'Emma',
  'Olivia',
  'Sophia',
  'Isabella',
  'Mia',
  'Charlotte',
  'Abigail',
  'Ella',
  'Madison',
  'Amelia',
  'Harper',
  'Avery',
  'Sofia',
  'Scarlett',
  'Grace',
  'Chloe',
  'Penelope',
  'Zoey',
  'Nora',
  'Lily',
  'Hannah',
  'Aria',
  'Layla',
  'Riley',
  'Zoe',
  'Addison',
  'Natalia',
  'Ellie',
  'Leah',
  'Aubrey',
  'Stella',
  'Paisley',
  'Everly',
  'Aurora',
  'Savannah',
  'Audrey',
  'Brooklyn',
  'Bella',
  'Claire',
  'Skylar',
  'Lucy',
  'Paisley',
  'Everly',
  'Anna',
  'Caroline',
  'Genesis',
  'Aaliyah',
  'Kennedy',
  'Kinsley',
  'Allison',
  'Maya',
  'Sarah',
  'Madeline',
  // Additional names
  'Abby',
  'Ada',
  'Agnes',
  'Alexia',
  'Alma',
  'Beatrice',
  'Bianca',
  'Caitlin',
  'Camila',
  'Carla',
  'Carly',
  'Celeste',
  'Clara',
  'Claudia',
  'Colleen',
  'Daisy',
  'Daphne',
  'Elaine',
  'Elena',
  'Eliza',
  'Fiona',
  'Flora',
  'Georgia',
  'Gwendolyn',
  'Harriet',
  'Hazel',
  'Holly',
  'Imogen',
  'Iris',
  'Ivy',
  'Josephine',
  'Julia',
  'June',
  'Katherine',
  'Lara',
  'Lillian',
  'Lois',
  'Lydia',
  'Maeve',
  'Miranda',
  'Naomi',
  'Phoebe',
  'Priscilla',
  'Rosemary',
  'Selena',
  'Sienna',
  'Sylvia',
  'Tamara',
  'Tessa',
  'Violet',
  'Vivian',
  'Wendy',
  'Whitney',
  //
  'Sofia',
  'Valentina',
  'Camila',
  'Gabriela',
  'Isabella',
  'Lucia',
  'Maria',
  'Ana',
  'Carmen',
  'Fernanda',
  'Alejandra',
  'Daniela',
  'Paola',
  'Andrea',
  'Monica',
  //
  'Keisha',
  'Latoya',
  'Shanice',
  'Tamika',
  'Ebony',
  'Destiny',
  'Jasmine',
  'Imani',
  'Nia',
  'Aaliyah',
  //
  'Aisha',
  'Fatimah',
  'Zainab',
  'Yuki',
  'Mei',
  'Ling',
  'Ji',
  'Hana',
  'Sakura',
  'Yuna'
])
const KNOWN_MALE_EN = new Set([
  // Pool names
  'Andrew',
  'James',
  'Robert',
  'Michael',
  'William',
  'David',
  'Richard',
  'Joseph',
  'Thomas',
  'Charles',
  'Christopher',
  'Daniel',
  'Matthew',
  'Anthony',
  'Mark',
  'Donald',
  'Steven',
  'Paul',
  'George',
  'Kenneth',
  // Classic / boomer generation
  'John',
  'Frank',
  'Peter',
  'Edward',
  'Henry',
  'Harold',
  'Walter',
  'Arthur',
  'Raymond',
  'Patrick',
  'Jack',
  'Dennis',
  'Jerry',
  'Alexander',
  'Nicholas',
  'Brian',
  'Gary',
  'Timothy',
  'Larry',
  'Jeffrey',
  'Scott',
  'Eric',
  'Stephen',
  'Alan',
  'Carl',
  'Douglas',
  'Eugene',
  'Fred',
  'Gerald',
  'Gregory',
  'Howard',
  'Keith',
  'Lawrence',
  'Leonard',
  'Louis',
  'Philip',
  'Ralph',
  'Roger',
  'Roy',
  'Russell',
  'Stanley',
  'Terry',
  'Wayne',
  'Randy',
  'Albert',
  'Ernest',
  'Fred',
  // Millennial
  'Ryan',
  'Kevin',
  'Jason',
  'Justin',
  'Brandon',
  'Samuel',
  'Benjamin',
  'Nathan',
  'Tyler',
  'Zachary',
  'Dylan',
  'Logan',
  'Jordan',
  'Austin',
  'Kyle',
  'Derek',
  'Dustin',
  'Jesse',
  'Joshua',
  'Travis',
  'Cody',
  'Blake',
  'Chase',
  'Tanner',
  'Connor',
  'Caleb',
  'Hunter',
  'Evan',
  'Ian',
  'Seth',
  'Garrett',
  'Jared',
  // Gen Z / modern
  'Ethan',
  'Noah',
  'Liam',
  'Oliver',
  'Elijah',
  'Lucas',
  'Mason',
  'Aiden',
  'Jackson',
  'Sebastian',
  'Owen',
  'Carter',
  'Isaac',
  'Adam',
  'Luke',
  'Wyatt',
  'Lincoln',
  'Leo',
  'Henry',
  'Grayson',
  'Julian',
  'Hudson',
  'Mateo',
  'Ezra',
  'Miles',
  'Eli',
  'Nolan',
  'Christian',
  'Aaron',
  'Cameron',
  'Colton',
  'Landon',
  'Adrian',
  'Dominic',
  'Jaxon',
  'Xavier',
  'Cooper',
  'Brayden',
  'Gavin',
  //
  'Carlos',
  'Miguel',
  'Jose',
  'Luis',
  'Juan',
  'Diego',
  'Alejandro',
  'Ricardo',
  'Fernando',
  'Eduardo',
  'Andres',
  'Rafael',
  'Marco',
  'Felipe',
  'Sergio',
  //
  'DeShawn',
  'Malik',
  'Darius',
  'Jamal',
  'Tyrone',
  'Marcus',
  'Darnell',
  'Terrell',
  'Devante',
  'Kalani',
  //
  'Rahul',
  'Rohan',
  'Aditya',
  'Kiran',
  'Vijay',
  'Anand',
  'Ravi',
  'Deepak',
  //
  'Wei',
  'Jun',
  'Hao',
  'Jian',
  'Hiroshi',
  'Kenji',
  'Takeshi',
  'Jin',
  'Sung',
  'Min'
])

/**
 * All known first names (FR + EN, both genders) — used as anchor in multi-word heuristic detection.
 * A multi-word capitalized sequence is only treated as a person name if at least one token
 * matches this set, reducing false positives on headings and document terms.
 */
export const KNOWN_FIRST_NAMES: ReadonlySet<string> = new Set([
  ...KNOWN_FEMALE_FR,
  ...KNOWN_MALE_FR,
  ...KNOWN_FEMALE_EN,
  ...KNOWN_MALE_EN
])

function normalizeNameToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLocaleLowerCase()
}

const KNOWN_FEMALE_NORMALIZED = new Set(
  [...KNOWN_FEMALE_FR, ...KNOWN_FEMALE_EN].map(normalizeNameToken)
)

const KNOWN_MALE_NORMALIZED = new Set([...KNOWN_MALE_FR, ...KNOWN_MALE_EN].map(normalizeNameToken))

function inferTokenGender(token: string): Gender {
  const normalized = normalizeNameToken(token)
  if (!normalized) return null

  const isFemale = KNOWN_FEMALE_NORMALIZED.has(normalized)
  const isMale = KNOWN_MALE_NORMALIZED.has(normalized)

  if (isFemale && !isMale) return 'F'
  if (isMale && !isFemale) return 'M'
  return null
}

/**
 * Infer gender from a first name using known French and English name lists.
 * Returns 'F', 'M', or null (unknown / could be a last name).
 */
export function inferGender(name: string): Gender {
  const direct = inferTokenGender(name)
  if (direct !== null) return direct

  const tokens = name
    .split(/[\s\-'.’]+/u)
    .map((token) => token.trim())
    .filter(Boolean)

  let femaleHits = 0
  let maleHits = 0

  for (const token of tokens) {
    const tokenGender = inferTokenGender(token)
    if (tokenGender === 'F') femaleHits += 1
    if (tokenGender === 'M') maleHits += 1
  }

  if (femaleHits > 0 && maleHits === 0) return 'F'
  if (maleHits > 0 && femaleHits === 0) return 'M'

  return null
}

export function fakeFirstName(
  original: string,
  locale: Locale = 'fr',
  gender: Gender = null
): string {
  if (locale === 'fr') {
    const pool =
      gender === 'F'
        ? FIRST_NAMES_FR_F
        : gender === 'M'
          ? FIRST_NAMES_FR_M
          : [...FIRST_NAMES_FR_M, ...FIRST_NAMES_FR_F]
    return pickFrom(pool, 'fn_' + original)
  }
  const pool =
    gender === 'F'
      ? FIRST_NAMES_EN_F
      : gender === 'M'
        ? FIRST_NAMES_EN_M
        : [...FIRST_NAMES_EN_M, ...FIRST_NAMES_EN_F]
  return pickFrom(pool, 'fn_' + original)
}

export function fakeLastName(original: string, locale: Locale = 'fr'): string {
  return pickFrom(locale === 'fr' ? LAST_NAMES_FR : LAST_NAMES_EN, 'ln_' + original)
}

export function fakeEmail(original: string, locale: Locale = 'fr'): string {
  const domains = ['sample-mail.com', 'test-inbox.net', 'demo-post.org', 'example-box.com'] as const
  const domain = pickFrom(domains, 'em_' + original)
  const firstNames = locale === 'fr' ? FIRST_NAMES_FR_M : FIRST_NAMES_EN_M
  const lastNames = locale === 'fr' ? LAST_NAMES_FR : LAST_NAMES_EN
  const fn = pickFrom(firstNames, 'efn_' + original)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
  const ln = pickFrom(lastNames, 'eln_' + original)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
  return `${fn}.${ln}@${domain}`
}

export function fakePhone(original: string): string {
  const cleaned = original.replace(/[\s.\-()]/g, '')
  let seed = simpleHash('ph_' + original)
  const nextDigit = (): string => {
    seed = (seed * 1664525 + 1013904223) | 0
    return String(Math.abs(seed) % 10)
  }

  if (/^\+?33/.test(cleaned) || /^0[1-9]/.test(cleaned)) {
    // French format
    const d = [
      nextDigit(),
      nextDigit(),
      nextDigit(),
      nextDigit(),
      nextDigit(),
      nextDigit(),
      nextDigit(),
      nextDigit()
    ]
    return `0${Math.abs(simpleHash('mobile_' + original)) % 2 === 0 ? '6' : '7'} ${d[0]}${d[1]} ${d[2]}${d[3]} ${d[4]}${d[5]} ${d[6]}${d[7]}`
  }

  // Generic: preserve non-digit chars, randomize digits
  let result = ''
  for (const ch of original) {
    result += /\d/.test(ch) ? nextDigit() : ch
  }
  return result
}

export function fakeAddress(original: string, locale: Locale = 'fr'): string {
  const num = (simpleHash('addr_' + original) % 99) + 1
  const street =
    locale === 'fr'
      ? pickFrom(STREETS_FR, 'str_' + original)
      : pickFrom(STREETS_EN, 'str_' + original)
  return `${num} ${street}`
}

export function fakeCity(original: string, locale: Locale = 'fr'): string {
  return pickFrom(locale === 'fr' ? CITIES_FR : CITIES_EN, 'city_' + original)
}

export function fakeZipCode(original: string): string {
  const trimmed = original.trim()
  const h = simpleHash('zip_' + original)
  if (/^\d{5}$/.test(trimmed)) {
    // French: keep 2-digit dept prefix
    return trimmed.slice(0, 2) + String(h % 1000).padStart(3, '0')
  }
  if (/^\d{5}(-\d{4})?$/.test(trimmed)) {
    // US ZIP
    return String(10000 + (h % 89999))
  }
  return original
}

export function fakeSSN(original: string): string {
  const cleaned = original.replace(/[\s-]/g, '')
  if (/^[12]\d{12,14}$/.test(cleaned)) {
    const gender = cleaned[0]!
    let seed = simpleHash('ssn_' + original)
    let result = gender
    for (let i = 1; i < cleaned.length; i++) {
      seed = (seed * 1664525 + 1013904223) | 0
      result += String(Math.abs(seed) % 10)
    }
    if (/\s/.test(original)) {
      return `${result[0]} ${result.slice(1, 3)} ${result.slice(3, 5)} ${result.slice(5, 7)} ${result.slice(7, 10)} ${result.slice(10, 13)} ${result.slice(13)}`
    }
    return result
  }
  if (/^\d{3}-\d{2}-\d{4}$/.test(original.trim())) {
    const h = simpleHash('ssn_' + original)
    return `${100 + (h % 899)}-${10 + ((h >> 4) % 89)}-${1000 + ((h >> 8) % 8999)}`
  }
  return original
}

export function fakePassword(original: string): string {
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const LOWER = 'abcdefghjkmnpqrstuvwxyz'
  const DIGITS = '23456789'
  const SYMBOLS = '!@#$%&*?'
  let state = simpleHash('pw_' + original)
  let result = ''
  for (const ch of original) {
    state = (state * 1664525 + 1013904223) | 0
    const s = Math.abs(state)
    if (/[A-Z]/.test(ch)) result += UPPER[s % UPPER.length]
    else if (/[a-z]/.test(ch)) result += LOWER[s % LOWER.length]
    else if (/[0-9]/.test(ch)) result += DIGITS[s % DIGITS.length]
    else if (/[^a-zA-Z0-9]/.test(ch)) result += SYMBOLS[s % SYMBOLS.length]
    else result += ch
  }
  return result
}

export function fakeCompany(original: string, locale: Locale = 'fr'): string {
  return pickFrom(locale === 'fr' ? COMPANIES_FR : COMPANIES_EN, 'co_' + original)
}

export function fakeOccupation(original: string, locale: Locale = 'fr'): string {
  return pickFrom(locale === 'fr' ? JOB_TITLES_FR : JOB_TITLES_EN, 'occ_' + original)
}

export function fakeDate(original: string): string {
  const h = (simpleHash('date_' + original) % 180) + 30

  let date: Date | null = null
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(original.trim())
  const frMatch = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(original.trim())

  if (isoMatch) {
    date = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`)
  } else if (frMatch) {
    const year = frMatch[3]!.length === 2 ? `20${frMatch[3]}` : frMatch[3]
    date = new Date(`${year}-${frMatch[2]}-${frMatch[1]}`)
  }

  if (!date || isNaN(date.getTime())) return original
  date.setDate(date.getDate() + h)

  if (isoMatch) return date.toISOString().slice(0, 10)
  if (frMatch) {
    const d = String(date.getDate()).padStart(2, '0')
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const y =
      frMatch[3]!.length === 2 ? String(date.getFullYear()).slice(2) : String(date.getFullYear())
    return `${d}/${m}/${y}`
  }
  return original
}

export function fakeKeyReference(original: string): string {
  let seed = simpleHash('ref_' + original)
  let result = ''
  for (const ch of original) {
    if (/\d/.test(ch)) {
      seed = (seed * 1664525 + 1013904223) | 0
      result += String(Math.abs(seed) % 10)
    } else {
      result += ch
    }
  }
  return result
}
