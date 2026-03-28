import { useEffect, useRef, useState } from "react";
import {
  DetailRow,
  EmptyState,
  initials,
} from "@/shared/ui";
import ClientForm from "./ClientForm";
import { createClient, updateClient, deleteClient } from "@/services/complianceApi";

function scoreTone(score) {
  if (score <= 70) return "text-danger";
  if (score <= 85) return "text-warning";
  return "text-accent";
}

function scoreBar(score) {
  if (score <= 70) return "bg-danger";
  if (score <= 85) return "bg-warning";
  return "bg-accent";
}

function priorityTone(priority) {
  if (priority === "HIGH") return "bg-orange-100 text-orange-800";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-teal-100 text-teal-800";
}

function getName(client) {
  return client?.profile?.name || client?.name || "—";
}

function getIndustry(client) {
  return client?.profile?.industry || client?.industry || "Unspecified";
}

function getConstitution(client) {
  return client?.profile?.constitution || client?.constitution || "";
}

function getPriority(client) {
  return client?.profile?.priority || client?.priority || "LOW";
}

function getScore(client) {
  return client?.risk?.compliance_score ?? client?.risk_profile?.compliance_score ?? 100;
}

function getMisses(client) {
  return client?.risk?.recent_misses ?? client?.risk_profile?.recent_misses ?? 0;
}

function getObligations(client) {
  return client?.obligations || client?.active_obligations || [];
}

function getIdentifiers(client) {
  return client?.registrations || client?.identifiers || {};
}

function getHighRiskAreas(client) {
  return client?.risk?.high_risk_areas || client?.risk_profile?.high_risk_areas || [];
}

export default function ClientProfilesView({ clients: initialClients, loading, onClientsChanged, initialSelectedId, onClearDeepLink }) {
  const [clients, setClients] = useState(initialClients || []);
  const [selectedId, setSelectedId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [actionMsg, setActionMsg] = useState("");
  const detailRef = useRef(null);

  useEffect(() => { setClients(initialClients || []); }, [initialClients]);

  useEffect(() => {
    if (!initialSelectedId) return;
    setSelectedId(initialSelectedId);
    if (onClearDeepLink) onClearDeepLink();
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [initialSelectedId]);

  async function handleSave(data) {
    if (editingClient) {
      const updated = await updateClient(editingClient.id, data);
      setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setActionMsg(`${updated.profile?.name || updated.id} updated`);
    } else {
      const created = await createClient(data);
      setClients((prev) => [...prev, created]);
      setSelectedId(created.id);
      setActionMsg(`${created.profile?.name || created.id} added`);
    }
    setFormOpen(false);
    setEditingClient(null);
    onClientsChanged?.();
    setTimeout(() => setActionMsg(""), 3000);
  }

  async function handleDelete(clientId) {
    if (!window.confirm("Delete this client? This cannot be undone.")) return;
    await deleteClient(clientId);
    setClients((prev) => prev.filter((c) => c.id !== clientId));
    setSelectedId(null);
    setActionMsg("Client deleted");
    onClientsChanged?.();
    setTimeout(() => setActionMsg(""), 3000);
  }

  useEffect(() => {
    if (!clients.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !clients.some((client) => client.id === selectedId)) {
      setSelectedId(clients[0].id);
    }
  }, [clients, selectedId]);

  const selected = clients.find((client) => client.id === selectedId) || clients[0] || null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <div />
        <button
          onClick={() => { setEditingClient(null); setFormOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-panel transition hover:bg-slate-700"
        >
          <span className="material-symbols-outlined text-base">person_add</span>
          Add Client
        </button>
      </div>

      {actionMsg && (
        <div className="shrink-0 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-800">
          {actionMsg}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-h-0 flex-col xl:col-span-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">
                Clients
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {clients.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {clients.length ? (
                clients.map((client) => {
                  const active = selected?.id === client.id;
                  const score = getScore(client);
                  return (
                    <button
                      key={client.id}
                      onClick={() => setSelectedId(client.id)}
                      className={`w-full border-l-4 p-4 text-left transition ${
                        active
                          ? `${score <= 70 ? "border-danger" : score <= 85 ? "border-warning" : "border-accent"} bg-slate-50`
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-700">
                            {initials(getName(client))}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">
                              {getName(client)}
                            </p>
                            <p className="text-[11px] text-muted">
                              {getIndustry(client)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${priorityTone(
                            getPriority(client),
                          )}`}
                        >
                          {getPriority(client)}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-slate-200">
                          <div
                            className={`h-1.5 rounded-full ${scoreBar(score)}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-bold ${scoreTone(score)}`}>
                          {score}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-4">
                  <EmptyState
                    message={loading ? "Loading clients..." : "No clients found."}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col xl:col-span-8" ref={detailRef}>
          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
              <div className="shrink-0 border-b border-slate-200 bg-slate-50 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                      {initials(getName(selected))}
                    </div>
                    <div>
                      <p className="font-headline text-lg font-bold text-slate-950">
                        {getName(selected)}
                      </p>
                      <p className="text-xs text-muted">
                        {getConstitution(selected) || "Unknown constitution"} · {getIndustry(selected)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${priorityTone(
                        getPriority(selected),
                      )}`}
                    >
                      {getPriority(selected)}
                    </span>
                    <p className="font-mono text-[11px] text-muted">{selected.id}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingClient(selected); setFormOpen(true); }}
                        className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span>
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(selected.id)}
                        className="flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <FactPill label="Compliance Score" value={`${getScore(selected)}/100`} highlight={scoreTone(getScore(selected))} />
                  <FactPill label="Recent Misses" value={getMisses(selected)} />
                  <FactPill label="Tags" value={(selected.tags || []).length} />
                  <FactPill label="Obligations" value={getObligations(selected).length} />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                      Client Details
                    </p>
                    <DetailRow label="Client ID" value={selected.id} />
                    <DetailRow label="Client Type" value={selected.client_type || "business"} />
                    <DetailRow label="Constitution" value={getConstitution(selected)} />
                    <DetailRow label="Industry" value={getIndustry(selected)} />
                    <DetailRow label="Priority" value={getPriority(selected)} />
                    {selected.profile?.email && <DetailRow label="Email" value={selected.profile.email} />}
                    {selected.profile?.phone && <DetailRow label="Phone" value={selected.profile.phone} />}
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                      Identifiers
                    </p>
                    {Object.entries(getIdentifiers(selected)).filter(([, v]) => v).length ? (
                      Object.entries(getIdentifiers(selected))
                        .filter(([, v]) => v)
                        .map(([key, value]) => (
                          <DetailRow key={key} label={key.replace(/_/g, " ").toUpperCase()} value={value} />
                        ))
                    ) : (
                      <EmptyState message="No identifiers recorded." />
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-200 p-6">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Regulatory Tags
                  </p>
                  {(selected.tags || []).length ? (
                    <div className="flex flex-wrap gap-2">
                      {selected.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <EmptyState message="No tags assigned." />
                  )}
                </div>

                {getHighRiskAreas(selected).length > 0 ? (
                  <div className="border-t border-slate-200 p-6">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                      High Risk Areas
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {getHighRiskAreas(selected).map((area) => (
                        <span
                          key={area}
                          className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                        >
                          <span className="material-symbols-outlined text-sm">warning</span>
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="border-t border-slate-200 p-6">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                      Obligations
                    </p>
                    <span className="text-xs text-muted">
                      {getObligations(selected).length} total
                    </span>
                  </div>

                  {getObligations(selected).length ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[540px] text-left">
                        <thead className="border-b border-slate-200 bg-slate-50">
                          <tr>
                            {["Obligation", "Regulator", "Due Date", "Status", "Penalty"].map((heading) => (
                              <th
                                key={heading}
                                className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted"
                              >
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {getObligations(selected).map((ob, i) => (
                            <tr key={ob.code || i} className="transition hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <p className="font-mono text-xs font-semibold text-slate-900">{ob.code}</p>
                                <p className="text-[11px] text-muted capitalize">{ob.frequency}</p>
                              </td>
                              <td className="px-4 py-3">
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                                  {ob.regulator}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700">{ob.due_date || "—"}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                  ob.status === "overdue" || ob.status === "critical" ? "bg-rose-100 text-rose-700"
                                  : ob.status === "pending" || ob.status === "action_needed" ? "bg-amber-100 text-amber-700"
                                  : "bg-teal-100 text-teal-700"
                                }`}>
                                  {ob.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted">{ob.penalty || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState message="No obligations recorded." />
                  )}
                </div>

                {selected.notes && (
                  <div className="border-t border-slate-200 p-6">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">CA Notes</p>
                    <p className="text-sm leading-relaxed text-slate-700">{selected.notes}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-10 shadow-panel">
              <EmptyState
                message={loading ? "Loading client data..." : "Select a client to view their profile."}
              />
            </div>
          )}
        </div>
      </div>

      {formOpen && (
        <ClientForm
          existingClient={editingClient}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditingClient(null); }}
        />
      )}
    </div>
  );
}

function FactPill({ label, value, highlight }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${highlight || "text-slate-900"}`}>{value}</p>
    </div>
  );
}
