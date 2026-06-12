"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "로그인에 실패했습니다.");
      }

      window.location.href = "/";
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "로그인에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <p className="eyebrow">ServeFit Admin</p>
        <h1>관리자 로그인</h1>
        <p>분석 생성과 코칭 기록 관리는 관리자만 사용할 수 있습니다.</p>

        <label>
          <span>비밀번호</span>
          <input
            autoFocus
            inputMode="numeric"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호 입력"
            type="password"
            value={password}
          />
        </label>

        {error ? <p className="login-error">{error}</p> : null}

        <button disabled={isSubmitting || password.length === 0} type="submit">
          {isSubmitting ? "확인 중" : "로그인"}
        </button>
      </form>
    </main>
  );
}
