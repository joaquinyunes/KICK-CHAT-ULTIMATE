import { execSync } from "child_process";

const CANDIDATES = [
  process.env.PYTHON_PATH,
  "python",
  "python3",
  "py",
].filter(Boolean) as string[];

export function findPython(module?: string): string {
  const check = module ? `-c "import ${module}"` : "-c \"\"";
  for (const exe of CANDIDATES) {
    try {
      execSync(`"${exe}" ${check}`, { timeout: 3000, encoding: "utf-8" });
      return exe;
    } catch {}
  }
  return "python";
}
