// Comedy styles you can pick in the Claude panel. Each id names a skill in
// worker/comedy/<id>/, which the worker adds to Claude's system prompt.
export const COMEDY_STYLES = [
  {
    id: "rock-esque-observational-standup",
    label: "Observational stand-up",
    after: "Chris Rock",
    hint: 'A bold "there\'s a difference between X and Y" claim, proven with escalating examples and a quotable closer.',
  },
  {
    id: "pryor-esque-confessional-standup",
    label: "Confessional stand-up",
    after: "Richard Pryor",
    hint: "A painful true story acted out in several voices, ending on a blunt truth instead of a moral.",
  },
  {
    id: "monty-python-esque",
    label: "Surreal sketch",
    after: "Monty Python",
    hint: "A mundane premise pushed to absurd, pedantic extremes, played straight, then cut off abruptly.",
  },
  {
    id: "gervais-esque-cringe-satire",
    label: "Cringe comedy",
    after: "Ricky Gervais",
    hint: "An oblivious, self-important character in excruciating scenes, or blunt stand-up about taboo truths.",
  },
  {
    id: "brooker-esque-media-satire",
    label: "Media satire",
    after: "Charlie Brooker",
    hint: "A cynical takedown of an app, show or trend, or a near-future story that gets bleaker one step at a time.",
  },
  {
    id: "cunk-esque-mockumentary",
    label: "Mockumentary",
    after: "Philomena Cunk",
    hint: "A confidently clueless presenter states garbled facts and quizzes a patient, sincere expert.",
  },
  {
    id: "clarke-dawe-esque",
    label: "Deadpan interview",
    after: "Clarke and Dawe",
    hint: "A two-person mock interview where an official answers terse questions with confident, escalating nonsense.",
  },
  {
    id: "bird-fortune-political-satire",
    label: "Establishment satire",
    after: "Bird and Fortune",
    hint: "A pompous minister or executive explains away hypocrisy in polished euphemism during a formal interview.",
  },
] as const;

export type ComedyStyle = (typeof COMEDY_STYLES)[number]["id"];
