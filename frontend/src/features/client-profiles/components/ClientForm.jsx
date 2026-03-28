import { useState, useEffect } from "react";

// ─── constants ───────────────────────────────────────────────────────────────

const CONSTITUTIONS = [
  "Private Limited Company", "Public Limited Company",
  "Limited Liability Partnership", "Proprietorship",
  "Partnership Firm", "Trust", "HUF", "Other",
];
const PRIORITIES    = ["HIGH", "MEDIUM", "LOW"];
const REGULATORS    = ["GST", "RBI", "FEMA", "IncomeTax", "MCA", "SEBI", "EPFO", "ESIC"];
const OB_STATUSES   = ["pending", "overdue", "critical", "action_needed", "compliant", "filed"];
const OB_FREQS      = ["monthly", "quarterly", "yearly", "one_time", "per_invoice", "half_yearly"];
const ITR_FORMS     = ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"];
const FILING_STATUSES = ["not_filed", "filed", "revised", "belated"];
const GST_FREQS     = ["Monthly", "Quarterly"];

const BUSINESS_TABS    = ["Profile", "Registrations", "Financials", "Compliance", "Obligations", "Tags"];
const INDIVIDUAL_TABS  = ["Profile", "Income", "Tax State", "Obligations", "Tags"];

// ─── blank templates ─────────────────────────────────────────────────────────

function blankBusiness() {
  return {
    client_type: "business",
    profile: {
      name: "", constitution: "Private Limited Company",
      industry: "", priority: "MEDIUM",
      email: "", phone: "", address: "",
    },
    registrations: { pan: "", tan: "", gstin: "", cin: "", iec_code: "", llpin: "" },
    financials: {
      turnover: "", advance_tax_paid: "",
      unrealised_forex_amount: "", oldest_invoice_age_days: "",
    },
    compliance_state: {
      lut_expiry_date: "", gst_filing_frequency: "Monthly",
      last_aoc4_filed: "", last_mgt7_filed: "",
      last_llp11_filed: "", last_llp8_filed: "",
      tax_audit_required: false, transfer_pricing_applicable: false,
      employee_count: "", ad_bank: "",
      scrutiny: { status: "none", section: "", assessment_year: "", reply_due_date: "" },
    },
    obligations: [],
    tags: [],
    notes: "",
  };
}

function blankIndividual() {
  return {
    client_type: "individual",
    profile: { name: "", pan: "", email: "", phone: "", address: "", nri_status: false },
    tax_context: {
      financial_year: "2025-26", assessment_year: "2026-27",
      salary_income: "", rental_income: "", business_income: "",
      foreign_income: "", capital_gains_stcg: "", capital_gains_ltcg: "",
    },
    compliance_state: {
      filing_status: "not_filed", itr_form: "ITR-2",
      advance_tax_paid: "", pending_refund: "",
      form16_received: false, dtaa_applicable: false,
      dtaa_country: "", dtaa_article: "",
      presumptive_scheme: "", employer_name: "", employer_tan: "",
      tds_deducted_by_clients: "",
    },
    deductions: { investments_80c: "", premium_80d: "" },
    obligations: [],
    tags: [],
    notes: "",
  };
}

function blankObligation() {
  return {
    code: "", regulator: "GST", status: "pending",
    frequency: "monthly", due_date: "", penalty: "", periods: "",
  };
}

// ─── small field components ───────────────────────────────────────────────────

function Field({ label, children, half }) {
  return (
    <div className={half ? "sm:col-span-1" : "sm:col-span-2"}>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:bg-white transition";
const selectCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:bg-white transition";

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputCls}
    />
  );
}

function NumberInput({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      placeholder={placeholder}
      className={inputCls}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <div
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-teal-500" : "bg-slate-300"}`}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </div>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

function SectionHeading({ children }) {
  return (
    <p className="col-span-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-teal-600">
      {children}
    </p>
  );
}

// ─── tab sections ─────────────────────────────────────────────────────────────

function ProfileTab({ form, set }) {
  const isIndividual = form.client_type === "individual";
  const p = form.profile || {};

  const setProfile = (key, val) =>
    set((f) => ({ ...f, profile: { ...f.profile, [key]: val } }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Client Type" half>
        <div className="flex gap-3">
          {["business", "individual"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set(t === "business" ? blankBusiness() : blankIndividual())}
              className={`flex-1 rounded-xl border py-2 text-sm font-semibold capitalize transition ${
                form.client_type === t
                  ? "border-teal-500 bg-teal-50 text-teal-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Full Name">
        <TextInput value={p.name} onChange={(v) => setProfile("name", v)} placeholder="Client name" />
      </Field>

      {!isIndividual && (
        <>
          <Field label="Constitution" half>
            <SelectInput value={p.constitution} onChange={(v) => setProfile("constitution", v)} options={CONSTITUTIONS} />
          </Field>
          <Field label="Industry" half>
            <TextInput value={p.industry} onChange={(v) => setProfile("industry", v)} placeholder="e.g. Manufacturing & Export" />
          </Field>
          <Field label="Priority" half>
            <SelectInput value={p.priority} onChange={(v) => setProfile("priority", v)} options={PRIORITIES} />
          </Field>
        </>
      )}

      {isIndividual && (
        <>
          <Field label="PAN" half>
            <TextInput value={p.pan} onChange={(v) => setProfile("pan", v.toUpperCase())} placeholder="ABCDE1234F" />
          </Field>
          <Field label="NRI Status" half>
            <div className="flex h-[38px] items-center">
              <Toggle label="Resident outside India" checked={!!p.nri_status} onChange={(v) => setProfile("nri_status", v)} />
            </div>
          </Field>
        </>
      )}

      <Field label="Email" half>
        <TextInput type="email" value={p.email} onChange={(v) => setProfile("email", v)} placeholder="email@domain.com" />
      </Field>
      <Field label="Phone" half>
        <TextInput value={p.phone} onChange={(v) => setProfile("phone", v)} placeholder="+91-9XXXXXXXXX" />
      </Field>
      <Field label="Address">
        <TextInput value={p.address} onChange={(v) => setProfile("address", v)} placeholder="Full address" />
      </Field>
    </div>
  );
}

function RegistrationsTab({ form, set }) {
  const r = form.registrations || {};
  const isLLP = (form.profile?.constitution || "").toLowerCase().includes("llp");

  const setReg = (key, val) =>
    set((f) => ({ ...f, registrations: { ...f.registrations, [key]: val } }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="PAN" half>
        <TextInput value={r.pan} onChange={(v) => setReg("pan", v.toUpperCase())} placeholder="AABCA1234F" />
      </Field>
      <Field label="TAN" half>
        <TextInput value={r.tan} onChange={(v) => setReg("tan", v.toUpperCase())} placeholder="MUMA12345B" />
      </Field>
      <Field label="GSTIN" half>
        <TextInput value={r.gstin} onChange={(v) => setReg("gstin", v.toUpperCase())} placeholder="27AABCA1234F1Z5" />
      </Field>
      <Field label="IEC Code" half>
        <TextInput value={r.iec_code} onChange={(v) => setReg("iec_code", v)} placeholder="0315012345" />
      </Field>
      {isLLP ? (
        <Field label="LLPIN" half>
          <TextInput value={r.llpin} onChange={(v) => setReg("llpin", v.toUpperCase())} placeholder="AAB-1234" />
        </Field>
      ) : (
        <Field label="CIN" half>
          <TextInput value={r.cin} onChange={(v) => setReg("cin", v.toUpperCase())} placeholder="U17111MH2015PTC123456" />
        </Field>
      )}
    </div>
  );
}

function FinancialsTab({ form, set }) {
  const fin = form.financials || {};

  const setFin = (key, val) =>
    set((f) => ({ ...f, financials: { ...f.financials, [key]: val } }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SectionHeading>Turnover & Tax</SectionHeading>
      <Field label="Annual Turnover (₹)" half>
        <NumberInput value={fin.turnover} onChange={(v) => setFin("turnover", v)} placeholder="45000000" />
      </Field>
      <Field label="Advance Tax Paid (₹)" half>
        <NumberInput value={fin.advance_tax_paid} onChange={(v) => setFin("advance_tax_paid", v)} placeholder="320000" />
      </Field>

      <SectionHeading>Foreign Exchange</SectionHeading>
      <Field label="Unrealised Forex Amount (₹)" half>
        <NumberInput value={fin.unrealised_forex_amount} onChange={(v) => setFin("unrealised_forex_amount", v)} placeholder="3200000" />
      </Field>
      <Field label="Oldest Invoice Age (days)" half>
        <NumberInput value={fin.oldest_invoice_age_days} onChange={(v) => setFin("oldest_invoice_age_days", v)} placeholder="145" />
      </Field>
    </div>
  );
}

function ComplianceTab({ form, set }) {
  const cs = form.compliance_state || {};
  const scrutiny = cs.scrutiny || {};
  const isLLP = (form.profile?.constitution || "").toLowerCase().includes("llp");

  const setCs = (key, val) =>
    set((f) => ({ ...f, compliance_state: { ...f.compliance_state, [key]: val } }));
  const setScrutiny = (key, val) =>
    set((f) => ({
      ...f,
      compliance_state: {
        ...f.compliance_state,
        scrutiny: { ...(f.compliance_state?.scrutiny || {}), [key]: val },
      },
    }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SectionHeading>GST</SectionHeading>
      <Field label="GST Filing Frequency" half>
        <SelectInput value={cs.gst_filing_frequency || "Monthly"} onChange={(v) => setCs("gst_filing_frequency", v)} options={GST_FREQS} />
      </Field>
      <Field label="LUT Expiry Date" half>
        <TextInput type="date" value={cs.lut_expiry_date} onChange={(v) => setCs("lut_expiry_date", v)} />
      </Field>

      <SectionHeading>MCA Filings</SectionHeading>
      {isLLP ? (
        <>
          <Field label="Last LLP-11 Filed" half>
            <TextInput value={cs.last_llp11_filed} onChange={(v) => setCs("last_llp11_filed", v)} placeholder="FY2023-24" />
          </Field>
          <Field label="Last LLP-8 Filed" half>
            <TextInput value={cs.last_llp8_filed} onChange={(v) => setCs("last_llp8_filed", v)} placeholder="FY2023-24" />
          </Field>
        </>
      ) : (
        <>
          <Field label="Last AOC-4 Filed" half>
            <TextInput value={cs.last_aoc4_filed} onChange={(v) => setCs("last_aoc4_filed", v)} placeholder="FY2023-24" />
          </Field>
          <Field label="Last MGT-7 Filed" half>
            <TextInput value={cs.last_mgt7_filed} onChange={(v) => setCs("last_mgt7_filed", v)} placeholder="FY2023-24" />
          </Field>
        </>
      )}

      <SectionHeading>Tax & Employees</SectionHeading>
      <Field label="Employee Count" half>
        <NumberInput value={cs.employee_count} onChange={(v) => setCs("employee_count", v)} placeholder="62" />
      </Field>
      <Field label="AD Bank" half>
        <TextInput value={cs.ad_bank} onChange={(v) => setCs("ad_bank", v)} placeholder="HDFC Bank, Fort Branch" />
      </Field>
      <Field label="Flags" half>
        <div className="flex flex-col gap-2 pt-1">
          <Toggle label="Tax Audit Required" checked={!!cs.tax_audit_required} onChange={(v) => setCs("tax_audit_required", v)} />
          <Toggle label="Transfer Pricing Applicable" checked={!!cs.transfer_pricing_applicable} onChange={(v) => setCs("transfer_pricing_applicable", v)} />
        </div>
      </Field>

      <SectionHeading>Scrutiny / Notices</SectionHeading>
      <Field label="Scrutiny Status" half>
        <SelectInput
          value={scrutiny.status || "none"}
          onChange={(v) => setScrutiny("status", v)}
          options={["none", "pending", "reply_pending", "demand_raised", "closed"]}
        />
      </Field>
      <Field label="Section" half>
        <TextInput value={scrutiny.section} onChange={(v) => setScrutiny("section", v)} placeholder="271(1)(c)" />
      </Field>
      <Field label="Assessment Year" half>
        <TextInput value={scrutiny.assessment_year} onChange={(v) => setScrutiny("assessment_year", v)} placeholder="2022-23" />
      </Field>
      <Field label="Reply Due Date" half>
        <TextInput type="date" value={scrutiny.reply_due_date} onChange={(v) => setScrutiny("reply_due_date", v)} />
      </Field>
    </div>
  );
}

function IncomeTaxTab({ form, set }) {
  const tc = form.tax_context || {};

  const setTc = (key, val) =>
    set((f) => ({ ...f, tax_context: { ...f.tax_context, [key]: val } }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SectionHeading>Assessment Period</SectionHeading>
      <Field label="Financial Year" half>
        <TextInput value={tc.financial_year} onChange={(v) => setTc("financial_year", v)} placeholder="2025-26" />
      </Field>
      <Field label="Assessment Year" half>
        <TextInput value={tc.assessment_year} onChange={(v) => setTc("assessment_year", v)} placeholder="2026-27" />
      </Field>

      <SectionHeading>Income Sources (₹)</SectionHeading>
      <Field label="Salary Income" half>
        <NumberInput value={tc.salary_income} onChange={(v) => setTc("salary_income", v)} placeholder="1800000" />
      </Field>
      <Field label="Rental Income" half>
        <NumberInput value={tc.rental_income} onChange={(v) => setTc("rental_income", v)} placeholder="240000" />
      </Field>
      <Field label="Business / Profession Income" half>
        <NumberInput value={tc.business_income} onChange={(v) => setTc("business_income", v)} placeholder="2800000" />
      </Field>
      <Field label="Foreign Income" half>
        <NumberInput value={tc.foreign_income} onChange={(v) => setTc("foreign_income", v)} placeholder="850000" />
      </Field>

      <SectionHeading>Capital Gains (₹)</SectionHeading>
      <Field label="STCG" half>
        <NumberInput value={tc.capital_gains_stcg} onChange={(v) => setTc("capital_gains_stcg", v)} placeholder="85000" />
      </Field>
      <Field label="LTCG" half>
        <NumberInput value={tc.capital_gains_ltcg} onChange={(v) => setTc("capital_gains_ltcg", v)} placeholder="210000" />
      </Field>
    </div>
  );
}

function TaxStateTab({ form, set }) {
  const cs = form.compliance_state || {};
  const ded = form.deductions || {};
  const isNRI = form.profile?.nri_status;

  const setCs = (key, val) =>
    set((f) => ({ ...f, compliance_state: { ...f.compliance_state, [key]: val } }));
  const setDed = (key, val) =>
    set((f) => ({ ...f, deductions: { ...f.deductions, [key]: val } }));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SectionHeading>ITR Filing</SectionHeading>
      <Field label="ITR Form" half>
        <SelectInput value={cs.itr_form || "ITR-2"} onChange={(v) => setCs("itr_form", v)} options={ITR_FORMS} />
      </Field>
      <Field label="Filing Status" half>
        <SelectInput value={cs.filing_status || "not_filed"} onChange={(v) => setCs("filing_status", v)} options={FILING_STATUSES} />
      </Field>
      <Field label="Advance Tax Paid (₹)" half>
        <NumberInput value={cs.advance_tax_paid} onChange={(v) => setCs("advance_tax_paid", v)} placeholder="45000" />
      </Field>
      <Field label="Pending Refund (₹)" half>
        <NumberInput value={cs.pending_refund} onChange={(v) => setCs("pending_refund", v)} placeholder="12000" />
      </Field>
      <Field label="TDS by Clients (₹)" half>
        <NumberInput value={cs.tds_deducted_by_clients} onChange={(v) => setCs("tds_deducted_by_clients", v)} placeholder="95000" />
      </Field>
      <Field label="Presumptive Scheme" half>
        <TextInput value={cs.presumptive_scheme} onChange={(v) => setCs("presumptive_scheme", v)} placeholder="44ADA / 44AD / blank" />
      </Field>
      <Field label="Employer Name" half>
        <TextInput value={cs.employer_name} onChange={(v) => setCs("employer_name", v)} placeholder="Infosys Limited" />
      </Field>
      <Field label="Employer TAN" half>
        <TextInput value={cs.employer_tan} onChange={(v) => setCs("employer_tan", v.toUpperCase())} placeholder="BNGI12345C" />
      </Field>
      <Field label="Flags" half>
        <div className="flex flex-col gap-2 pt-1">
          <Toggle label="Form 16 Received" checked={!!cs.form16_received} onChange={(v) => setCs("form16_received", v)} />
          <Toggle label="DTAA Applicable" checked={!!cs.dtaa_applicable} onChange={(v) => setCs("dtaa_applicable", v)} />
        </div>
      </Field>

      {cs.dtaa_applicable && (
        <>
          <Field label="DTAA Country" half>
            <TextInput value={cs.dtaa_country} onChange={(v) => setCs("dtaa_country", v)} placeholder="UAE" />
          </Field>
          <Field label="DTAA Article" half>
            <TextInput value={cs.dtaa_article} onChange={(v) => setCs("dtaa_article", v)} placeholder="Article 15" />
          </Field>
        </>
      )}

      <SectionHeading>Deductions</SectionHeading>
      <Field label="80C Investments (₹)" half>
        <NumberInput value={ded.investments_80c} onChange={(v) => setDed("investments_80c", v)} placeholder="150000" />
      </Field>
      <Field label="80D Premium (₹)" half>
        <NumberInput value={ded.premium_80d} onChange={(v) => setDed("premium_80d", v)} placeholder="22000" />
      </Field>
    </div>
  );
}

function ObligationsTab({ form, set }) {
  const obligations = form.obligations || [];

  const addObligation = () =>
    set((f) => ({ ...f, obligations: [...(f.obligations || []), blankObligation()] }));

  const removeObligation = (i) =>
    set((f) => ({ ...f, obligations: f.obligations.filter((_, idx) => idx !== i) }));

  const updateObligation = (i, key, val) =>
    set((f) => ({
      ...f,
      obligations: f.obligations.map((ob, idx) =>
        idx === i ? { ...ob, [key]: val } : ob
      ),
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Obligations drive automatic matching — add all pending/overdue items.
        </p>
        <button
          type="button"
          onClick={addObligation}
          className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-teal-600"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Obligation
        </button>
      </div>

      {obligations.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          No obligations added yet. Click "Add Obligation" to start.
        </div>
      )}

      {obligations.map((ob, i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Obligation {i + 1}
            </span>
            <button
              type="button"
              onClick={() => removeObligation(i)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              Remove
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code" half>
              <TextInput
                value={ob.code}
                onChange={(v) => updateObligation(i, "code", v.toUpperCase())}
                placeholder="GST_GSTR3B"
              />
            </Field>
            <Field label="Regulator" half>
              <SelectInput value={ob.regulator} onChange={(v) => updateObligation(i, "regulator", v)} options={REGULATORS} />
            </Field>
            <Field label="Status" half>
              <SelectInput value={ob.status} onChange={(v) => updateObligation(i, "status", v)} options={OB_STATUSES} />
            </Field>
            <Field label="Frequency" half>
              <SelectInput value={ob.frequency} onChange={(v) => updateObligation(i, "frequency", v)} options={OB_FREQS} />
            </Field>
            <Field label="Due Date" half>
              <TextInput type="date" value={ob.due_date} onChange={(v) => updateObligation(i, "due_date", v)} />
            </Field>
            <Field label="Penalty" half>
              <TextInput value={ob.penalty} onChange={(v) => updateObligation(i, "penalty", v)} placeholder="₹50/day" />
            </Field>
            <Field label="Periods (comma-separated)">
              <TextInput
                value={ob.periods}
                onChange={(v) => updateObligation(i, "periods", v)}
                placeholder="2026-01, 2026-02"
              />
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

function TagsTab({ form, set }) {
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    const existing = form.tags || [];
    if (!existing.includes(t)) {
      set((f) => ({ ...f, tags: [...(f.tags || []), t] }));
    }
    setTagInput("");
  };

  const removeTag = (tag) =>
    set((f) => ({ ...f, tags: (f.tags || []).filter((t) => t !== tag) }));

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">
          Regulatory Tags
        </label>
        <div className="flex gap-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
            placeholder="e.g. GST, FEMA, NRI..."
            className={inputCls + " flex-1"}
          />
          <button
            type="button"
            onClick={addTag}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Add
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(form.tags || []).map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-slate-100 pl-3 pr-1.5 py-1 text-xs font-semibold text-slate-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full hover:text-rose-600"
              >
                <span className="material-symbols-outlined text-sm leading-none">close</span>
              </button>
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          Common: GST · RBI · FEMA · IncomeTax · MCA · SEBI · EPFO · TDS · Export · NRI · NBFC
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">
          CA Notes
        </label>
        <textarea
          value={form.notes || ""}
          onChange={(e) => set((f) => ({ ...f, notes: e.target.value }))}
          rows={5}
          placeholder="Key facts, special instructions, relationships, history..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:bg-white transition"
        />
      </div>
    </div>
  );
}

// ─── main form ────────────────────────────────────────────────────────────────

export default function ClientForm({ existingClient, onSave, onClose }) {
  const [form, setForm] = useState(() =>
    existingClient ? structuredClone(existingClient) : blankBusiness()
  );
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isIndividual = form.client_type === "individual";
  const tabs = isIndividual ? INDIVIDUAL_TABS : BUSINESS_TABS;

  // Reset tab when client type changes
  useEffect(() => {
    setTab(0);
  }, [form.client_type]);

  // Normalize obligations: convert comma-string periods back to array on save
  function normalizeForSave(f) {
    const clone = structuredClone(f);
    clone.obligations = (clone.obligations || []).map((ob) => ({
      ...ob,
      periods: typeof ob.periods === "string"
        ? ob.periods.split(",").map((s) => s.trim()).filter(Boolean)
        : ob.periods || [],
    }));
    // Clean up empty string numbers
    if (clone.financials) {
      Object.keys(clone.financials).forEach((k) => {
        if (clone.financials[k] === "") clone.financials[k] = 0;
      });
    }
    return clone;
  }

  // Pre-populate periods as comma string when loading existing client
  useEffect(() => {
    if (existingClient) {
      setForm((f) => ({
        ...f,
        obligations: (f.obligations || []).map((ob) => ({
          ...ob,
          periods: Array.isArray(ob.periods) ? ob.periods.join(", ") : (ob.periods || ""),
        })),
      }));
    }
  }, []);

  async function handleSave() {
    const name = form.profile?.name?.trim();
    if (!name) { setError("Client name is required."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(normalizeForSave(form));
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[860px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
              {existingClient ? `Editing ${existingClient.id}` : "New Client"}
            </p>
            <h2 className="mt-1 font-headline text-[1.75rem] font-bold leading-none text-slate-950">
              {existingClient ? form.profile?.name || "Edit Client" : "Add Client"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-5 pt-3">
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(i)}
              className={`shrink-0 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ${
                tab === i
                  ? "border border-b-white border-slate-200 bg-white text-teal-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {error && (
            <div className="mb-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </div>
          )}

          {tab === 0 && <ProfileTab form={form} set={setForm} />}

          {!isIndividual && tab === 1 && <RegistrationsTab form={form} set={setForm} />}
          {!isIndividual && tab === 2 && <FinancialsTab form={form} set={setForm} />}
          {!isIndividual && tab === 3 && <ComplianceTab form={form} set={setForm} />}
          {!isIndividual && tab === 4 && <ObligationsTab form={form} set={setForm} />}
          {!isIndividual && tab === 5 && <TagsTab form={form} set={setForm} />}

          {isIndividual && tab === 1 && <IncomeTaxTab form={form} set={setForm} />}
          {isIndividual && tab === 2 && <TaxStateTab form={form} set={setForm} />}
          {isIndividual && tab === 3 && <ObligationsTab form={form} set={setForm} />}
          {isIndividual && tab === 4 && <TagsTab form={form} set={setForm} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-white px-7 py-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab((t) => Math.max(0, t - 1))}
              disabled={tab === 0}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setTab((t) => Math.min(tabs.length - 1, t + 1))}
              disabled={tab === tabs.length - 1}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
            >
              Next →
            </button>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-bold text-white transition hover:bg-teal-600 disabled:opacity-50"
            >
              {saving ? "Saving..." : existingClient ? "Save Changes" : "Add Client"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
