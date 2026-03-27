import { useEffect, useMemo, useState } from "react";

function priorityTone(priority) {
  if (priority === "HIGH") return "bg-amber-100 text-amber-800";
  if (priority === "MEDIUM") return "bg-slate-100 text-slate-700";
  return "bg-teal-100 text-teal-800";
}

function scoreTone(score) {
  if (score <= 70) return "text-amber-700";
  if (score <= 85) return "text-slate-700";
  return "text-teal-700";
}

function filterChipTone(value, current) {
  return value === current
    ? "bg-slate-950 text-white"
    : "bg-slate-100 text-slate-700 hover:bg-slate-200";
}

function getComplianceScore(client) {
  return client?.risk_profile?.compliance_score ?? 100;
}

function getRecentMisses(client) {
  return client?.risk_profile?.recent_misses ?? 0;
}

function averageComplianceScore(clients) {
  if (!clients.length) return 0;
  const total = clients.reduce((sum, client) => sum + getComplianceScore(client), 0);
  return Math.round(total / clients.length);
}

function getIndustryOptions(clients) {
  return ["All", ...new Set(clients.map((client) => client.industry).filter(Boolean))];
}

export default function ClientProfilesView({ clients, loading }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [selectedClientId, setSelectedClientId] = useState(null);

  const industryOptions = useMemo(() => getIndustryOptions(clients), [clients]);

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      const haystack = [
        client.id,
        client.name,
        client.constitution,
        client.industry,
        ...(client.tags || []),
        ...Object.values(client.identifiers || {}),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !searchQuery || haystack.includes(searchQuery.toLowerCase());
      const matchesPriority = priorityFilter === "All" || client.priority === priorityFilter;
      const matchesIndustry = industryFilter === "All" || client.industry === industryFilter;

      return matchesSearch && matchesPriority && matchesIndustry;
    });
  }, [clients, searchQuery, priorityFilter, industryFilter]);

  useEffect(() => {
    if (!filteredClients.length) {
      setSelectedClientId(null);
      return;
    }

    if (!selectedClientId || !filteredClients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(filteredClients[0].id);
    }
  }, [filteredClients, selectedClientId]);

  const selectedClient =
    filteredClients.find((client) => client.id === selectedClientId) || filteredClients[0] || null;

  const stats = {
    totalClients: clients.length,
    highPriority: clients.filter((client) => client.priority === "HIGH").length,
    activeObligations: clients.reduce(
      (sum, client) => sum + (client.active_obligations || []).length,
      0,
    ),
    averageScore: averageComplianceScore(clients),
  };

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Client Profiles
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Review client compliance footprint, obligations, and risk context.
          </p>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-end">
          <div className="relative xl:col-span-6">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              search
            </span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-teal-300 focus:bg-white"
              placeholder="Search client, industry, tag, or identifier..."
              type="text"
            />
          </div>

          <div className="xl:col-span-4">
            <FilterRow
              label="Priority"
              options={["All", "HIGH", "MEDIUM", "LOW"]}
              value={priorityFilter}
              onChange={setPriorityFilter}
            />
          </div>

          <div className="xl:col-span-2">
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Industry
            </label>
            <select
              value={industryFilter}
              onChange={(event) => setIndustryFilter(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-teal-300 focus:bg-white"
            >
              {industryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Total Clients" value={stats.totalClients} meta="Active registry records" tone="border-accent" />
        <StatCard title="High Priority" value={stats.highPriority} meta="Immediate oversight needed" tone="border-warning" />
        <StatCard title="Active Obligations" value={stats.activeObligations} meta="Across all client portfolios" tone="border-slate-900" />
        <StatCard title="Avg Compliance Score" value={`${stats.averageScore}%`} meta="Risk profile average" tone="border-teal-500" />
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-headline font-bold uppercase tracking-[0.22em] text-slate-500">
              Client Registry
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              {filteredClients.length} visible
            </span>
          </div>

          {filteredClients.length ? (
            filteredClients.map((client) => {
              const active = selectedClient?.id === client.id;
              const score = getComplianceScore(client);
              return (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full rounded-3xl border p-5 text-left shadow-panel transition ${
                    active
                      ? "border-teal-200 ring-2 ring-teal-100"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="font-headline text-lg font-bold text-slate-950">{client.name}</h4>
                      <p className="mt-1 text-sm text-slate-600">
                        {client.constitution} • {client.industry}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${priorityTone(
                        client.priority,
                      )}`}
                    >
                      {client.priority}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {(client.tags || []).slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        Compliance Score
                      </p>
                      <p className={`mt-1 text-xl font-headline font-extrabold ${scoreTone(score)}`}>
                        {score}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        Recent Misses
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">
                        {getRecentMisses(client)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <EmptyState
              message={loading ? "Loading client registry..." : "No clients match the current filters."}
            />
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel xl:col-span-7">
          {selectedClient ? (
            <>
              <div className="border-b border-slate-200 bg-slate-50 p-8">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-xl font-bold text-white">
                      {selectedClient.name
                        .split(" ")
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-headline text-2xl font-extrabold text-slate-950">
                        {selectedClient.name}
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        ID: {selectedClient.id} • {selectedClient.constitution} • {selectedClient.industry}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        {selectedClient.contact?.name || "No contact"} •{" "}
                        {selectedClient.contact?.email || "No email"}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] ${priorityTone(
                      selectedClient.priority,
                    )}`}
                  >
                    {selectedClient.priority} Priority
                  </span>
                </div>
              </div>

              <div className="p-8">
                <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
                  <section>
                    <SectionTitle title="Identifiers" />
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      {Object.entries(selectedClient.identifiers || {}).map(([key, value]) => (
                        <MetaCard
                          key={key}
                          label={key.toUpperCase()}
                          value={value}
                        />
                      ))}
                    </div>
                  </section>

                  <section>
                    <SectionTitle title="Tags" />
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(selectedClient.tags || []).length ? (
                        selectedClient.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-slate-600">No tags available.</p>
                      )}
                    </div>
                  </section>
                </div>

                <section className="mt-10">
                  <SectionTitle title="Regulatory Profile" />
                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                    {Object.entries(selectedClient.regulatory_profile || {}).map(([regulator, values]) => (
                      <div key={regulator} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-bold uppercase tracking-[0.14em] text-slate-800">
                          {regulator.replace("_", " ")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(values || []).map((item) => (
                            <span
                              key={item}
                              className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mt-10">
                  <div className="flex items-center justify-between">
                    <SectionTitle title="Active Obligations" />
                    <span className="text-xs font-semibold text-slate-500">
                      {(selectedClient.active_obligations || []).length} active
                    </span>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50">
                        <tr>
                          {["Obligation", "Due Date", "Status", "Risk", "Penalty"].map((label) => (
                            <th
                              key={label}
                              className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {(selectedClient.active_obligations || []).length ? (
                          selectedClient.active_obligations.map((obligation) => (
                            <tr key={obligation.id} className="bg-white">
                              <td className="px-4 py-4">
                                <p className="text-sm font-semibold text-slate-900">{obligation.type}</p>
                                <p className="mt-1 text-xs text-slate-500">{obligation.id}</p>
                              </td>
                              <td className="px-4 py-4 text-sm text-slate-800">{obligation.due_date}</td>
                              <td className="px-4 py-4 text-sm text-slate-800">{obligation.status}</td>
                              <td className="px-4 py-4">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${priorityTone(
                                    obligation.risk_level,
                                  )}`}
                                >
                                  {obligation.risk_level}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm text-slate-700">
                                {obligation.penalty_if_missed || "Not specified"}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="5" className="px-4 py-8">
                              <EmptyState message="No active obligations available." />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mt-10 grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white">
                    <div className="relative z-10">
                      <SectionTitle title="Risk Profile" dark />
                      <div className="mt-4 flex items-end gap-3">
                        <span className="font-headline text-5xl font-extrabold">
                          {getComplianceScore(selectedClient)}
                        </span>
                        <span className="pb-1 text-xl font-bold text-slate-400">/ 100</span>
                      </div>
                      <p className="mt-4 text-sm leading-7 text-slate-300">
                        Recent compliance behavior and active obligations shape this client’s current risk posture.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                    <SectionTitle title="High Risk Areas" />
                    <div className="mt-4 space-y-3">
                      {(selectedClient.risk_profile?.high_risk_areas || []).length ? (
                        selectedClient.risk_profile.high_risk_areas.map((area) => (
                          <div key={area} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                            <span className="text-sm font-medium text-slate-800">{area}</span>
                            <span className="material-symbols-outlined text-amber-600">warning</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-600">No high risk areas recorded.</p>
                      )}
                    </div>
                    <div className="mt-6 border-t border-slate-200 pt-4">
                      <MetadataRow
                        label="Recent Misses"
                        value={String(getRecentMisses(selectedClient))}
                      />
                    </div>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="p-10">
              <EmptyState message={loading ? "Loading client details..." : "Select a client to inspect details."} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterChipTone(
              option,
              value,
            )}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatCard({ title, value, meta, tone }) {
  return (
    <div className={`rounded-2xl border-l-4 ${tone} bg-white p-5 shadow-panel`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 font-headline text-3xl font-extrabold text-slate-950">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{meta}</p>
    </div>
  );
}

function SectionTitle({ title, dark = false }) {
  return (
    <h3
      className={`text-[11px] font-headline font-bold uppercase tracking-[0.2em] ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}
    >
      {title}
    </h3>
  );
}

function MetaCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900 break-all">{value}</p>
    </div>
  );
}

function MetadataRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
