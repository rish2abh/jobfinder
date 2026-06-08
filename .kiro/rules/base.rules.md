# Kiro Agent Base Rules — JobFinder System

## 🎯 Purpose

These rules define how the agent MUST behave while working on the JobFinder system to ensure:

* minimal token usage
* no duplicate work
* safe code changes
* maximum reuse of existing implementation

---

# 🧠 1. SOURCE OF TRUTH

The agent MUST follow this priority order:

1. implementation-state.md (what already exists)
2. requirement.md (what needs to be built)
3. existing code (only when required)

---

# 🔍 2. BEFORE ANY IMPLEMENTATION (MANDATORY)

The agent MUST ALWAYS:

1. Read implementation-state.md
2. Identify:

   * what is already implemented
   * what is partially implemented
   * what is missing
3. Decide:

   * extend existing logic OR
   * add new minimal logic

The agent MUST NOT start coding without this step.

---

# ⚙️ 3. FILE READING RULES (TOKEN OPTIMIZATION)

* DO NOT scan entire repository
* DO NOT open unrelated files
* ONLY read:

  * relevant module files
  * files directly related to the feature
* DO NOT re-read the same file multiple times
* Prefer specs over file reading

---

# 🧩 4. MODULE-BASED EXECUTION

The agent MUST:

1. Identify the module first (Auth, Resume, Job, Email, etc.)
2. Work ONLY inside that module
3. Avoid touching unrelated modules

---

# 🔁 5. EXTEND, DO NOT REBUILD

* IF functionality exists → reuse it
* IF partially exists → extend it
* IF missing → create minimal implementation

The agent MUST NOT:

* duplicate logic
* create parallel modules
* rewrite working code

---

# ✂️ 6. MINIMAL CODE CHANGES

* Modify only required files
* Do not rewrite full files
* Do not refactor unrelated code
* Keep changes small and focused

---

# 🧠 7. THINK BEFORE CODING

Before writing code, the agent MUST output:

1. What exists
2. What is missing
3. What will be modified
4. Which files will be touched

ONLY after this, proceed to code.

---

# ⚡ 8. PERFORMANCE & TOKEN RULES

* Avoid unnecessary explanations
* Avoid repeated analysis
* Avoid redundant file reads
* Prefer structured reasoning over brute force

---

# 🚫 9. STRICT PROHIBITIONS

The agent MUST NOT:

* scan full repository
* rewrite entire modules
* duplicate existing functionality
* ignore implementation-state.md
* make assumption-based changes

---

# 🔗 10. DOCUMENT USAGE RULE

* requirement.md → defines WHAT to build
* implementation-state.md → defines WHAT EXISTS

The agent MUST combine both before making decisions.

---

# ✅ 11. EXPECTED OUTPUT BEHAVIOR

The agent MUST:

1. Explain plan briefly
2. Show minimal code changes
3. Keep response concise
4. Focus only on relevant logic

---

# 🚀 FINAL GOAL

Efficient, incremental development with:

* zero duplicate work
* minimal token usage
* maximum reuse of existing system
