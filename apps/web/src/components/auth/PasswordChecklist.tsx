import { PASSWORD_RULES } from "../../lib/passwordRules";

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-2 space-y-1">
      {PASSWORD_RULES.map((r) => {
        const met = r.test(password);
        return (
          <li key={r.label} className={`text-xs ${met ? "text-green-600" : "text-gray-400"}`}>
            {met ? "✓" : "·"} {r.label}
          </li>
        );
      })}
    </ul>
  );
}
