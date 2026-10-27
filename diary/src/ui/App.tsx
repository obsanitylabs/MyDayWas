import React, { useCallback, useEffect, useRef, useState } from "react";
import { Diary, type DecryptedEntry, type Sentiment } from "../app/api";
import { connectAccounts, getInjectedProvider } from "../auth/wallet";
import { log } from "../log";

const SENTIMENTS: Sentiment[] = ["POSITIVE", "NEGATIVE", "NEUTRAL"];

function dayLabel(day: number): string {
  const d = new Date(day * 86_400_000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App(): React.ReactElement {
  const [diary, setDiary] = useState<Diary | null>(null);
  const [entries, setEntries] = useState<DecryptedEntry[]>([]);
  const [text, setText] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>("NEUTRAL");
  const [status, setStatus] = useState("checking device vault…");
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const bootRef = useRef(false);

  const refresh = useCallback(async (d: Diary) => {
    setEntries(await d.listEntries());
    setHasBackup(await d.hasPassphraseBackup());
  }, []);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    void (async () => {
      try {
        const d = await Diary.unlock();
        if (d) {
          setDiary(d);
          await refresh(d);
          const n = await d.reconcile();
          await refresh(d);
          setStatus(n > 0 ? "unlocked and synced" : "unlocked");
        } else {
          setStatus("no diary on this device yet");
        }
      } catch (e) {
        setErr(String(e));
        setStatus("");
      }
    })();
  }, [refresh]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!diary) return;
    return diary.scheduleFlush();
  }, [diary]);

  const onboard = async () => {
    setErr(null);
    setBusy(true);
    try {
      const provider = getInjectedProvider();
      if (!provider) throw new Error("No EIP-1193 wallet detected in this browser.");
      const [address] = await connectAccounts(provider);
      const d = await Diary.onboard(provider, address);
      setDiary(d);
      await refresh(d);
      setStatus("onboarded");
      log("app", "onboard complete");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!diary || !text.trim()) return;
    setBusy(true);
    try {
      await diary.addEntry(text, sentiment);
      setText("");
      await refresh(diary);
      setStatus(online ? "saved locally; will sync" : "saved locally (offline)");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (!diary) return;
    await diary.deleteEntry(id);
    await refresh(diary);
  };

  const exportJson = async () => {
    if (!diary) return;
    download("mydaywas-export.json", await diary.exportJSON(), "application/json");
    log("export", "plaintext JSON export downloaded");
  };

  const exportBackup = async () => {
    if (!diary) return;
    try {
      download("mydaywas-backup.json", await diary.exportEncryptedBackup(), "application/json");
    } catch (e) {
      setErr(String(e));
    }
  };

  const changePw = async () => {
    if (!diary) return;
    try {
      await diary.changePassphrase(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setErr(null);
      setStatus("passphrase backup updated");
    } catch (e) {
      setErr(String(e));
    }
  };

  const syncNow = async () => {
    if (!diary) return;
    const n = await diary.reconcile();
    await refresh(diary);
    setStatus(n > 0 ? "synced" : "up to date");
  };

  const deleteAccount = async () => {
    if (!diary) return;
    if (!window.confirm("Delete ALL diary entries and this account's sync ciphertext? This cannot be undone.")) return;
    await diary.deleteAccount();
    setDiary(null);
    setEntries([]);
    setStatus("account deleted");
  };

  return (
    <div className="app">
      <header className="site">
        <h1>MyDayWas</h1>
        <span className="tag">private diary · v1 (M3 staging)</span>
      </header>

      <div className="card">
        <p className="hint">
          Entries are encrypted on this device with AES-GCM-256 before they are stored or synced.
          Your wallet is used once at onboarding to derive the key; nothing about your diary or
          wallet is stored on-chain. Sync ciphertext is deleted within 72 hours.
        </p>
        <div className="row status">
          <span className={status.startsWith("unlocked") || status === "onboarded" || status === "synced" ? "ok" : undefined}>
            {status}
          </span>
          <span className="spacer" />
          <span>{online ? "online" : "offline — entries still work"}</span>
          {diary && <button onClick={syncNow}>Sync now</button>}
          {!diary && <button className="primary" onClick={onboard} disabled={busy}>Connect wallet &amp; create diary</button>}
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      {diary && (
        <>
          <div className="card">
            <h2>How was your day?</h2>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write here. Only you can read this — it is encrypted before it leaves the page."
            />
            <div className="row">
              <span className="sentiments">
                {SENTIMENTS.map((s) => (
                  <button key={s} aria-pressed={s === sentiment} onClick={() => setSentiment(s)}>
                    {s.toLowerCase()}
                  </button>
                ))}
              </span>
              <span className="spacer" />
              <button className="primary" onClick={add} disabled={busy || !text.trim()}>Save entry</button>
            </div>
          </div>

          <div className="card">
            <h2>Your diary ({entries.length})</h2>
            {entries.length === 0 && <p className="hint">No entries yet.</p>}
            {Object.entries(
              entries.reduce<Record<number, DecryptedEntry[]>>((acc, e) => {
                (acc[e.day] ??= []).push(e);
                return acc;
              }, {}),
            )
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([day, list]) => (
                <div className="daygroup" key={day}>
                  <div className="daylabel">{dayLabel(Number(day))}</div>
                  {list.map((e) => (
                    <div className="entry" key={e.id}>
                      <div className="meta">
                        <span className={"sent " + e.sentiment}>{e.sentiment.toLowerCase()}</span>
                        <span className="spacer" />
                        <button className="danger" onClick={() => del(e.id)}>Delete</button>
                      </div>
                      <p className="text">{e.text}</p>
                    </div>
                  ))}
                </div>
              ))}
          </div>

          <div className="card">
            <h2>Export &amp; recovery</h2>
            <div className="row">
              <button onClick={exportJson}>Export plaintext JSON</button>
              <button onClick={exportBackup} disabled={!hasBackup}>Export encrypted backup</button>
            </div>
            <p className="hint">
              {hasBackup
                ? "A passphrase-wrapped key backup exists on this account."
                : "No passphrase backup set on this device (it can only be set at onboarding in v1)."}
            </p>
            <p className="hint">
              Recovery trade-offs you should know: your diary key is derived from your wallet.
              If someone obtains <strong>both your wallet seed and your sync account access</strong>,
              they can re-derive your key and decrypt your diary. And if you lose{" "}
              <strong>your device, your passphrase backup, and your wallet</strong> at the same time,
              your diary cannot be recovered by anyone — keep at least one of the three safe.
            </p>
            <details className="backup">
              <summary>Change passphrase</summary>
              <div className="row">
                <input type="password" placeholder="current passphrase" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                <input type="password" placeholder="new passphrase" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                <button onClick={changePw} disabled={!oldPw || !newPw}>Update</button>
              </div>
            </details>
            <div className="row">
              <span className="spacer" />
              <button className="danger" onClick={deleteAccount}>Delete account…</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}