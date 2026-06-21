// Default ZotExtract extraction questions — comparison-first.
//
// Each question is one matrix ROW read across many papers, so answers are short and
// normalized rather than verbose prose. Questions come in three types, each with an
// output contract baked into the prompt text so they work standalone and inside the
// shared settings template:
//   - binary   -> exactly Yes / No / Unclear
//   - list     -> a deduplicated list of short normalized names, or None
//   - semantic -> free text capped at maxWords, or Not reported
var ZotExtractPromptPresets = {
    contracts: {
        binary: 'Output format: exactly one word — Yes, No, or Unclear.',
        list: 'Output format: a deduplicated list of short, normalized names — one per line — or "None" if none are reported.',
        semantic(maxWords) {
            return `Output format: at most ${maxWords} words, plain text, comparable across papers, or "Not reported" if the paper does not report it.`;
        }
    },

    render(core, type, maxWords) {
        const contract = type === 'semantic' ? this.contracts.semantic(maxWords) : this.contracts[type];
        return `${core}\n\n${contract}`;
    },

    corePrompts() {
        return [];
    },

    fieldPacks() {
        const q = (id, name, type, core, maxWords) => ({
            id,
            name,
            type,
            ...(maxWords ? { maxWords } : {}),
            context: 'fulltext',
            prompt: this.render(core, type, maxWords)
        });
        return [
            {
                id: 'overview',
                name: 'Overview & Scope',
                description: 'Contribution, research question, and the tasks the paper targets.',
                prompts: [
                    q('contribution', 'Core contribution', 'semantic',
                        'State the single main contribution or claim of this paper.', 30),
                    q('research-question', 'Research question', 'semantic',
                        'State the central research question(s) or objective the paper addresses.', 40),
                    q('tasks', 'Tasks addressed', 'list',
                        'Which standard named tasks or problem settings does the paper directly study, excluding methods, broad topics, and evaluation/case-study examples?')
                ]
            },
            {
                id: 'methods-data',
                name: 'Methods & Data',
                description: 'Core method, datasets used, and whether humans evaluated results.',
                prompts: [
                    q('method', 'Method / approach', 'semantic',
                        'What is the paper’s core method, model, or technique for achieving its contribution?', 40),
                    q('datasets', 'Datasets used', 'list',
                        'Which named datasets or benchmarks, not tools/models, did the paper directly use for training or evaluation, excluding referenced-only model/tool/API datasets?'),
                    q('human-eval', 'Human evaluation?', 'binary',
                        'Does the paper report any human-involved study, human judgment, manual validation, or user-facing A/B evaluation of results?')
                ]
            },
            {
                id: 'results',
                name: 'Results & Evaluation',
                description: 'Headline result, baselines, metrics, and statistical testing.',
                prompts: [
                    q('main-result', 'Headline result', 'semantic',
                        'What is the paper’s main quantitative result or theorem, including its metric, value or bound, and any stated comparison?', 35),
                    q('baselines', 'Baselines compared', 'list',
                        'Which baseline or competing methods are explicitly compared with the paper’s proposed approach in the empirical evaluation?'),
                    q('metrics', 'Evaluation metrics', 'list',
                        'Which reported quantitative or categorical metric, performance measure, or outcome measure names appear, excluding values, category labels, findings, datasets, methods, tools, parameters, sample sizes?'),
                    q('significance-testing', 'Statistical testing?', 'binary',
                        'For its main results, does the paper report any statistical test, p-value, confidence interval, or statistical significance/non-significance statement?')
                ]
            },
            {
                id: 'critique',
                name: 'Limitations & Critique',
                description: 'Author-acknowledged limitations and threats to validity.',
                prompts: [
                    q('limitations', 'Key limitation', 'semantic',
                        'What, if any, primary limitation, validity threat, or scope restriction do authors explicitly acknowledge about their own study, method, or results, not prior work?', 40)
                ]
            },
            {
                id: 'reproducibility',
                name: 'Reproducibility',
                description: 'Public availability of code and data.',
                prompts: [
                    q('code-available', 'Code available?', 'binary',
                        'Is there an explicit URL in the paper specifically for publicly available code, a code repository, or a replication package?'),
                    q('data-available', 'Data available?', 'binary',
                        'Does the paper state that any data or dataset it used or created is publicly available, or provide where to access it?')
                ]
            }
        ];
    },

    getFieldPack(fieldId) {
        return this.fieldPacks().find(pack => pack.id === fieldId) || null;
    },

    allPrompts() {
        const prompts = this.corePrompts();
        for (const pack of this.fieldPacks()) {
            for (const prompt of pack.prompts) {
                prompts.push({ ...prompt, field: pack.id });
            }
        }
        return prompts;
    },

    clonePrompt(prompt, fieldId) {
        return {
            id: prompt.id,
            name: prompt.name,
            type: prompt.type || 'semantic',
            ...(prompt.maxWords ? { maxWords: prompt.maxWords } : {}),
            field: fieldId || prompt.field || 'core',
            context: prompt.context || 'fulltext',
            output: prompt.output || 'json',
            prompt: prompt.prompt
        };
    }
};
