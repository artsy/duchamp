/**
 * Topic skills: vendored skills in .claude/topic-skills/<vendor>/<skill>/, the repos they
 * review, and `when`, a plain description of the code each covers. Every review in a
 * listed repo gets the skills and a prompt line that tells the reviewer to run one when
 * the diff matches its `when`. The reviewer decides, since it reads the whole diff and
 * can tell that a wrapper calls the vendor's API where a pattern could not. Unlike stack
 * skills they are not part of the best-practices experiment: listing the repo is the
 * opt-in, and adding one takes a duchamp PR.
 */
export type TopicSkill = {
  skill: string
  vendor: string
  repos: string[]
  when: string
}

const STRIPE_REPOS = [
  "artsy/gravity",
  "artsy/exchange",
  "artsy/force",
  "artsy/eigen",
]

export const TOPIC_SKILLS: TopicSkill[] = [
  {
    skill: "stripe-best-practices",
    vendor: "stripe",
    repos: STRIPE_REPOS,
    when: "Stripe integration code: calls to Stripe's API or SDK, including through a wrapper class, webhook handlers, checkout, billing, tax setup, or Stripe API keys",
  },
]

/** Where a topic skill lives under .claude/topic-skills. */
export const topicSkillPath = ({ vendor, skill }: TopicSkill): string =>
  `${vendor}/${skill}`

/** Topic skills listed for the repo, in any case. */
export const topicSkillsFor = (repo: string | undefined): TopicSkill[] =>
  TOPIC_SKILLS.filter(({ repos }) =>
    repos.some(r => r.toLowerCase() === repo?.toLowerCase())
  )

export const formatTopicSkillsSection = (topics: TopicSkill[]): string => {
  if (topics.length === 0) {
    return ""
  }

  return [
    "\n## Topic Practices\n",
    "Each skill below covers one topic. After you read the diff and before you write findings, decide for each whether the diff touches the code it covers. If it does, run that skill with the Skill tool. If it doesn't, don't run it and don't mention it.\n",
    ...topics.map(({ skill, when }) => `- \`${skill}\`: ${when}.`),
    "",
    "When you run a skill:\n",
    "- Use it as a checklist for the lines the diff changes. Open the reference file that matches what the change does and read it before you judge that code.",
    "- Name the rule in every finding it leads to, as `(rule: <rule or reference file name>)`.",
    "- Its findings go under Suggestions unless the diff itself proves the problem, such as a secret key in code, a webhook handler that doesn't verify the signature, or a call the skill says never to make.",
    "- Skills like these state the latest API and SDK versions, because they were written to help build an integration. Don't ask for an upgrade only because a newer version exists. Flag a deprecated API, or one the diff newly introduces.",
    "- Skip any step that sets something up or reaches outside the repo: creating accounts, keys or sandboxes, running the vendor's CLI or MCP server, fetching its docs, or asking the user something.",
    "- Judge only the code the diff changes. Don't review the rest of the integration against the skill.",
    "- If the Skill tool says a skill does not exist, do that read yourself and say so in the summary.",
    "- In the summary, say in one line which skills ran and how many of their findings you posted.\n",
  ].join("\n")
}
