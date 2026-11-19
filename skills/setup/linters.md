# Linters and checks by stack

Read by the `setup` skill when it configures the quality bar of a project (`harness-audit.md`, item `quality`). A starting point to propose from, not a list to install wholesale: prefer what the repo already has, pin the version where the project pins its tools, and confirm with the Owner before installing anything.

Kokpit runs the single-file command after every edit of a matching file and reports only problems on the lines the edit changed. It must therefore take one file and finish in a few seconds; slower whole-project checks belong in "Verification".

| Stack | Linter | Install | Config file | Single-file command for `checks.lint` |
|---|---|---|---|---|
| GDScript (Godot 4) | gdtoolkit (`gdlint`, `gdformat`) | `pip install "gdtoolkit==4.*"` | `gdlintrc` (`gdlint --dump-default-config`) | `gdlint {file}` |
| Dart / Flutter | the analyzer | with the SDK | `analysis_options.yaml` (`package:flutter_lints` or `package:lints`) | `dart analyze {file}` |
| Python | Ruff | `pip install ruff` or `uv add --dev ruff` | `[tool.ruff]` in `pyproject.toml` or `ruff.toml` | `ruff check {file}` |
| TypeScript / JavaScript | ESLint or Biome | `npm i -D eslint typescript-eslint` / `npm i -D @biomejs/biome` | `eslint.config.js` / `biome.json` | `npx eslint {file}` / `npx biome lint {file}` |
| Go | golangci-lint | binary release | `.golangci.yml` | `golangci-lint run {file}` (package scope: use Verification) |
| Rust | Clippy | with rustup | `clippy.toml`, `[lints]` in `Cargo.toml` | crate scope only: put `cargo clippy` in Verification |
| Swift | SwiftLint | `brew install swiftlint` | `.swiftlint.yml` | `swiftlint lint {file}` |
| Kotlin | ktlint or detekt | binary / Gradle plugin | `.editorconfig` / `detekt.yml` | `ktlint {file}` |
| C# | .NET analyzers | with the SDK | `.editorconfig` | project scope only: `dotnet build -warnaserror` in Verification |
| C / C++ | clang-tidy | with LLVM | `.clang-tidy` | `clang-tidy {file}` (needs `compile_commands.json`) |
| Shell | ShellCheck | `brew install shellcheck` | `.shellcheckrc` | `shellcheck {file}` |
| Lua | luacheck | `luarocks install luacheck` | `.luacheckrc` | `luacheck {file}` |

## Turning a recurring mistake into a rule

When the interview names a mistake agents keep making, look for a rule that catches it, in this order:

1. **An existing rule of the linter**, switched on in its config file (most "anti-patterns" already exist: unused code, any-types, broad exceptions, magic numbers, long functions).
2. **A project pattern in Kokpit**: a regular expression in `checks.patterns` for a construct that must not come back (a deprecated helper, a forbidden import). Kokpit reports it on added lines like a suppression.
3. **A custom lint rule** (an ESLint plugin, a Ruff/Flake8 plugin, `custom_lint` for Dart, a small script in Verification) when the pattern needs the syntax tree.
4. **Only then a sentence** in the project file or an area rule, because text is a request and a rule is a check.

## Measuring tests

Coverage counts executed lines, not checked behaviour. When the Owner wants to know whether the tests would catch a bug, mutation testing changes the code on purpose and counts the changes no test noticed: `mutmut` (Python), Stryker (JavaScript, TypeScript, C#), `mutation_test` (Dart), `cargo-mutants` (Rust). It is slow: propose it as a named background job in `.claude/kokpit.json` (`/job mutants <path>`), run on the files of one change, never after every edit.

## The `checks` section of `.claude/kokpit.json`

```json
{
  "tests": "<test command>",
  "checks": {
    "lint": [{ "files": ["**/*.gd"], "command": "gdlint {file}" }],
    "patterns": ["OldInventory\\.get_item\\("],
    "suppressions": true,
    "excuses": true,
    "markdown": ["docs/**", ".claude/**", "**/README.md"]
  }
}
```

- `lint`: per glob, a command taking one file (`{file}` is replaced by the path, otherwise the path is appended).
- `patterns`: regular expressions that must not appear on added lines.
- `suppressions` and `excuses`: Kokpit's built-in detection of checker suppressions and workaround comments on added lines (on by default).
- `markdown`: where a new `.md` file may appear without asking (`false` turns the check off).
- `"checks": false` turns all of it off for the project.
