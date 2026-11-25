// The 20 fixed questions. `hints` are generic (not person-specific) search words that widen the
// keyword half of hybrid retrieval for vague questions such as "a funny anecdote".
export const QUERIES = [
  { n: 1, topic: 'Birth', template: 'Where and when was {person} born?', hints: 'born birth birthplace birthday baptized native town year' },
  { n: 2, topic: 'Parents', template: "Where were {person}'s parents from, and what did they do?", hints: 'father mother parents emigrated trade occupation family ancestors' },
  { n: 3, topic: 'Childhood', template: "What was {person}'s childhood like?", hints: 'childhood boy girl boyhood girlhood young youth early years play' },
  { n: 4, topic: 'Siblings', template: "Who were {person}'s siblings?", hints: 'brother brothers sister sisters siblings youngest eldest children of family' },
  { n: 5, topic: 'Schooling', template: 'What schooling or training did {person} have?', hints: 'school schooling education taught learned grammar reading studied apprentice training college' },
  { n: 6, topic: 'First job', template: "What was {person}'s first job?", hints: 'first job work employed apprentice apprenticed trade shop worked wages' },
  { n: 7, topic: 'Adventure', template: "An adventurous story from {person}'s life.", hints: 'adventure journey voyage ran away escape expedition sailed travelled' },
  { n: 8, topic: 'Danger', template: 'A scary or dangerous moment {person} faced.', hints: 'danger dangerous storm shipwreck narrowly escaped peril fear risk nearly drowned' },
  { n: 9, topic: 'Humor', template: 'A funny anecdote about {person}.', hints: 'funny humor joke laughed amusing anecdote wit witty story' },
  { n: 10, topic: 'Failure', template: 'A time {person} failed or made a serious mistake.', hints: 'mistake error failed failure regretted erratum fault wrong misjudged' },
  { n: 11, topic: 'Hardship', template: 'The hardest thing {person} went through.', hints: 'grief death loss illness hardship suffering sorrow painful trial misfortune' },
  { n: 12, topic: 'Marriage', template: 'Who did {person} marry, and what was that relationship like?', hints: 'married marriage wife husband wedding courtship spouse' },
  { n: 13, topic: 'Children', template: "What about {person}'s children?", hints: 'son daughter children child born grandson died' },
  { n: 14, topic: 'Friends & mentors', template: "Who were {person}'s closest friends or mentors?", hints: 'friend friends friendship mentor patron companion intimate club' },
  { n: 15, topic: 'Rivals', template: "Who were {person}'s rivals or enemies?", hints: 'enemy enemies rival rivals opponent quarrel hostile attacked dispute' },
  { n: 16, topic: 'Best known for', template: 'What is {person} best known for?', hints: 'famous fame known renowned celebrated reputation achievement' },
  { n: 17, topic: 'Creations', template: 'Something {person} made, invented or discovered.', hints: 'invented invention discovered discovery experiment designed created devised' },
  { n: 18, topic: 'Travels & homes', template: 'Where did {person} travel or live?', hints: 'lived travelled visited moved residence house settled abroad returned' },
  { n: 19, topic: 'Habits & quirks', template: 'A habit, hobby or quirk of {person}.', hints: 'habit habits hobby custom fond practice daily routine peculiar' },
  { n: 20, topic: 'Death & legacy', template: 'How did {person} die, and how is {person} remembered?', hints: 'died death funeral buried grave last illness remembered memory legacy' },
];

export const fillQuery = (template, person) => String(template).split('{person}').join(person);

export const NOT_IN_SOURCES = 'Not in the sources.';
