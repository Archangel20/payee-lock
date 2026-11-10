"use client";

import { useEffect, useState } from "react";
import { AddressCode } from "@/components/AddressCode";
import { Countdown } from "@/components/Countdown";
import { chainLabel, eventLabel } from "@/lib/chains";
import type { ActivityEvent, AddressView, PayeeView } from "@/lib/types";

type Profile = PayeeView & { chain_time_ms: number };

export function ProfileApp({ accountId }: { accountId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [payeeResponse, activityResponse] = await Promise.all([
        fetch(`/api/payee?account=${encodeURIComponent(accountId)}`),
        fetch(`/api/activity?payee=${encodeURIComponent(accountId)}&limit=40`),
      ]);
      const payeeBody = await payeeResponse.json();
      const activityBody = await activityResponse.json();
      if (cancelled) return;
      if (!payeeResponse.ok) {
        setError(payeeBody.error ?? "Payee not found");
        setProfile(null);
        return;
      }
      setError(null);
      setProfile(payeeBody as Profile);
      setEvents((activityBody.events ?? []) as ActivityEvent[]);
    }
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [accountId]);

  if (error) return <p className="error">{error}</p>;
  if (!profile) return <p className="muted">Reading the registry…</p>;

  const pending = profile.addresses.filter((item) => item.pending);
  return (
    <>
      <div className="lede">
        <p className="kicker">Payee profile</p>
        <h1>{profile.display_name}</h1>
        <p>
          {profile.account_id}
          <br />
          Guardian {profile.guardian ?? "not appointed"} · change delay {profile.delay_seconds} seconds
        </p>
      </div>
      {pending.map((item) => (
        <div className="banner" key={item.chain}>
          <strong>{chainLabel(item.chain)} change is public and not active.</strong>
          <div>
            {item.activates_at_ms ? (
              <Countdown activatesAt={item.activates_at_ms} chainNow={profile.chain_time_ms} />
            ) : null}{" "}
            until it would replace the address on file. The current address still verifies.
          </div>
          <div className="small">Proposed: {item.pending}</div>
        </div>
      ))}
      <div className="card" style={{ marginTop: 18 }}>
        <table className="chain-table">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Address that verifies now</th>
              <th>Pending</th>
            </tr>
          </thead>
          <tbody>
            {profile.addresses.map((item) => (
              <AddressRow key={item.chain} item={item} />
            ))}
          </tbody>
        </table>
      </div>
      <section className="section">
        <h2>Activity</h2>
        <ul className="log">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{eventLabel(event.kind)}</strong>
              <span className="small muted">
                {event.chain ? `${chainLabel(event.chain)} · ` : ""}
                {event.address ? `${event.address} · ` : ""}
                {event.actor} · {new Date(event.at_ms).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
        {events.length === 0 ? <p className="muted">No events yet.</p> : null}
      </section>
    </>
  );
}

function AddressRow({ item }: { item: AddressView }) {
  return (
    <tr>
      <td>{chainLabel(item.chain)}</td>
      <td>{item.current ? <AddressCode value={item.current} /> : <span className="muted">None yet</span>}</td>
      <td>
        {item.pending ? <AddressCode value={item.pending} /> : <span className="muted">—</span>}
        {item.needs_settle ? <div className="small">Delay elapsed. Waiting for settle.</div> : null}
      </td>
    </tr>
  );
}
