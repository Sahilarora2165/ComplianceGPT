import { useEffect, useMemo, useRef, useState } from "react";
import {
  DetailRow,
  EmptyState,
  StatCard,
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

// clients.json uses nested profile/risk structure — normalize here
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

const PRIORITY_OPTIONS = ["All", "HIGH", "MEDIUM", "LOW"];

export default function ClientProfilesView({ clients: initialClients, loading, onClientsChanged }) {
  const [clients, setClients] = useState(initialClients || []);
  const [search, setSearch] = useState("");
  const [priFilter, setPriFilter] = useState("All");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [actionMsg, setActionMsg] = useState("");
  const filterRef = useRef(null);

  useEffect(() => { setClients(initialClients || []); }, [initialClients]);

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

  const industries = useMemo(
    () => ["All", ...new Set(clients.map((c) => getIndustry(c)).filter((v) => v !== "Unspecified"))],
    [clients],
  );

  const filtered = useMemo(
    () =>
      clients.filter((client) => {
        const haystack = [
          client.id,
          getName(client),
          getConstitution(client),
          getIndustry(client),
          ...(client.tags || []),
        ]
          .join(" ")
          .toLowerCase();

        return (
          (!search || haystack.includes(search.toLowerCase())) &&
          (priFilter === "All" || getPriority(client) === priFilter) &&
          (industryFilter === "All" || getIndustry(client) === industryFilter)
        );
      }),
    [clients, search, priFilter, industryFilter],
  );

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !filtered.some((client) => client.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    function onClickOutside(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);

    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const selected = filtered.find((client) => client.id === selectedId) || filtered[0] || null;

  const stats = {
    total: clients.length,
    highPriority: clients.filter((c) => getPriority(c) === "HIGH").length,
    obligations: clients.reduce((sum, c) => sum + getObligations(c).length, 0),
    avgScore: clients.length
      ? Math.round(clients.reduce((sum, c) => sum + getScore(c), 0) / clients.length)
      : 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
            Client Intelligence
          </p>
          <h1 className="font-headline text-[2.15rem] font-extrabold leading-tight tracking-tight text-slate-950">
            Client Profiles
          </h1>
          <p className="text-sm text-slate-600">
            Review compliance footprint, obligations, and risk context per client.
          </p>
        </div>
        <div className="w-full xl:w-auto">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-[repeat(4,minmax(0,170px))_auto] xl:items-stretch">
            <StatCard title="Total" value={stats.total} tone="border-slate-400" />
            <StatCard title="High Priority" value={stats.highPriority} tone="border-warning" />
            <StatCard title="Obligations" value={stats.obligations} tone="border-accent" />
            <StatCard title="Avg Score" value={`${stats.avgScore}/100`} tone="border-teal-500" />
            <button
              onClick={() => { setEditingClient(null); setFormOpen(true); }}
              className="col-span-2 flex min-h-[88px] items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white shadow-panel transition hover:bg-slate-700 xl:col-span-1 xl:min-w-[158px]"
            >
              <span className="material-symbols-outlined text-base">person_add</span>
              Add Client
            </button>
          </div>
        </div>
      </div>

      {actionMsg && (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-800">
          {actionMsg}
        </div>
      )}

      <div className="rounded-2xl bg-white px-4 pb-4 pt-6 shadow-panel">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-[1.35]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              search
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
              placeholder="Search client name, industry, or tag..."
            />
          </div>

          <div ref={filterRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:w-[320px] xl:self-center">
            <FilterSelect
              label="Industry"
              value={industryFilter}
              options={industries}
              isOpen={openDropdown === "industry"}
              onChange={setIndustryFilter}
              onToggle={() =>
                setOpenDropdown((current) => (current === "industry" ? null : "industry"))
              }
              onClose={() => setOpenDropdown(null)}
            />
            <FilterSelect
              label="Priority"
              value={priFilter}
              options={PRIORITY_OPTIONS}
              isOpen={openDropdown === "priority"}
              onChange={setPriFilter}
              onToggle={() =>
                setOpenDropdown((current) => (current === "priority" ? null : "priority"))
              }
              onClose={() => setOpenDropdown(null)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">
                Clients
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>

            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length ? (
                filtered.map((client) => {
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                            {initials(getName(client))}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {getName(client)}
                            </p>
                            <p className="mt-0.5 text-xs text-muted truncate">
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
                    message={loading ? "Loading clients..." : "No clients match filters."}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-8">
          {selected ? (
            <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 p-6">
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

function FilterSelect({ label, value, options, onChange, isOpen, onToggle, onClose }) {
  return (
    <div className="relative block pt-0">
      <span className="pointer-events-none absolute -top-4 left-3 text-[10px] font-bold uppercase tracking-widest text-muted">
        {label}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-[46px] w-full items-center justify-between rounded-xl border bg-slate-50 px-3 text-sm text-slate-700 outline-none transition ${
          isOpen ? "border-accent bg-white shadow-sm" : "border-line hover:bg-white"
        }`}
      >
        <span className="truncate text-sm font-medium text-slate-800">{value}</span>
        <span
          className={`material-symbols-outlined text-sm text-muted transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      <div
        className={`absolute left-0 right-0 top-full z-20 mt-2 origin-top rounded-2xl border border-slate-200 bg-white p-1 shadow-xl transition duration-200 ${
          isOpen ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              onChange(option);
              onClose();
            }}
            className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
              option === value
                ? "bg-slate-950 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
