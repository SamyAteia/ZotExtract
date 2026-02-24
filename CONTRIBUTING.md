# Contributing to ZotExtract

Thank you for your interest in contributing to ZotExtract! This project is part of the [NFDIxCS](https://nfdixcs.org/) initiative and we welcome contributions from the community.

## How to Contribute

### Reporting Bugs

1. Check the [existing issues](https://github.com/SamyAteia/ZotExtract/issues) to avoid duplicates.
2. Open a [new issue](https://github.com/SamyAteia/ZotExtract/issues/new?template=bug_report.md) with:
   - A clear, descriptive title.
   - Steps to reproduce the problem.
   - Expected vs. actual behaviour.
   - Your Zotero version and operating system.

### Suggesting Features

Open a [feature request](https://github.com/SamyAteia/ZotExtract/issues/new?template=feature_request.md) describing:
- The problem you're trying to solve.
- Your proposed solution.
- Any alternatives you considered.

### Submitting Code

1. **Fork** the repository and create a new branch from `main`:
   ```bash
   git checkout -b feature/my-improvement
   ```
2. Make your changes — keep commits focused and well-described.
3. **Test** your changes by building the plugin and loading it in Zotero 7:
   ```bash
   ./build.sh        # Linux/macOS
   build.cmd          # Windows
   ```
4. Open a **Pull Request** against `main` with a clear description of what changed and why.

### Code Style

- Use clear, descriptive variable and function names.
- Add JSDoc comments to public methods.
- Keep functions focused — prefer small, single-purpose functions.
- Follow the existing code style and indentation (4 spaces).

### Commit Messages

Write clear commit messages:

```
feat: add support for Anthropic API format
fix: handle missing PDF attachments gracefully
docs: update configuration instructions
```

Use conventional prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/SamyAteia/ZotExtract.git
   cd ZotExtract
   ```
2. Build the `.xpi`:
   ```bash
   ./build.sh
   ```
3. Install in Zotero 7 via **Tools → Add-ons → Install from File**.

## License

By contributing, you agree that your contributions will be licensed under the [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/).

## Questions?

- Open a [Discussion](https://github.com/SamyAteia/ZotExtract/discussions) on GitHub.
- Contact the maintainer: [Samy Ateia](mailto:Samy.Ateia@sprachlit.uni-regensburg.de) (University of Regensburg, Chair of Information Science).
- Reach out to the NFDIxCS team at [nfdixcs.org/contact](https://nfdixcs.org/contact).
