Ok. Regarding resources, I have to think about the requirement _where_ they can come from. Example:

- a prompt can be a local file, e.g. `.agent-harness/resources/system-prompt.md` that gets then processed accordingly
- skills on the other hand can be either local or via _another CLI_, like the currently popular `npx skills add ...` by Vercel, see https://github.com/vercel-labs/skills

I general I think the resources need to be flashed out more before work on code can start. I need to think deeply about resource types/specimen/whatever I should name them best, and how to integrate remote and local data into a cohesive, predictable and reliable system. The current SPEC.md is already really good, but I can use an adjcent file `RESOURCES.SPEC.md` to specifically deifne the resource details there.

If necessary, I have to search the web for inspiration or fact checking.
