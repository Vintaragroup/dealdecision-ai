import { CheckCircle2, AlertTriangle } from "lucide-react";

type FigmaPropertyConfig = Record<string, unknown>;

const defineProperties = (_component: unknown, _props: FigmaPropertyConfig) => {
  // no-op in the app build; used by design tooling/story contexts when available
};

export default function Component({
  score = 48,
  raise = "$2.5M",
  revenue = "$1.2M ARR",
  growth = "220%",
  customers = "180",
  businessModel = "SaaS",
  dealType = "Series A",
  confidence = "High",
  dealSummary = "Series A round for a high-growth SaaS platform with strong revenue traction and expanding customer base across enterprise segments.",
  strengths = "Exceptional YoY growth rate, Proven SaaS business model, Strong customer retention",
  weaknesses = "Limited market penetration, Early-stage profitability, Competitive landscape risk"
}) {
  // Determine score color based on value
  const getScoreColor = (score: number) => {
    if (score >= 70) return { 
      stroke: "stroke-emerald-400", 
      text: "text-emerald-400",
      glow: "drop-shadow-[0_0_12px_rgba(52,211,153,0.4)]"
    };
    if (score >= 40) return { 
      stroke: "stroke-amber-400", 
      text: "text-amber-400",
      glow: "drop-shadow-[0_0_12px_rgba(251,191,36,0.4)]"
    };
    return { 
      stroke: "stroke-red-400", 
      text: "text-red-400",
      glow: "drop-shadow-[0_0_12px_rgba(248,113,113,0.4)]"
    };
  };

  const scoreColor = getScoreColor(score);
  const percentage = score / 100;
  const circumference = 2 * Math.PI * 85;
  const strokeDashoffset = circumference * (1 - percentage);

  // Parse strengths and weaknesses
  const strengthsList = strengths.split(',').map(s => s.trim()).filter(s => s);
  const weaknessesList = weaknesses.split(',').map(w => w.trim()).filter(w => w);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Donut Chart (1/3) */}
          <div className="flex items-center justify-center lg:col-span-1">
            <div className="relative">
              <svg width="220" height="220" viewBox="0 0 220 220" className="transform -rotate-90">
                {/* Background circle */}
                <circle
                  cx="110"
                  cy="110"
                  r="85"
                  fill="none"
                  stroke="rgba(63, 63, 70, 0.3)"
                  strokeWidth="22"
                />
                {/* Progress circle */}
                <circle
                  cx="110"
                  cy="110"
                  r="85"
                  fill="none"
                  className={`${scoreColor.stroke} ${scoreColor.glow} transition-all duration-500`}
                  strokeWidth="22"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  style={{
                    transition: 'stroke-dashoffset 1s ease-in-out'
                  }}
                />
              </svg>
              
              {/* Center Text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className={`text-4xl font-bold ${scoreColor.text} transition-colors duration-300`}>
                  {score}<span className="text-zinc-500 text-3xl">/100</span>
                </div>
                <div className="text-xs text-zinc-400 mt-2">Fundamentals score</div>
              </div>
            </div>
          </div>

          {/* Right Columns: Metrics Grid (2/3) */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            
            {/* Raise */}
            <div className="rounded-[12px] bg-zinc-800/50 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <div className="text-xs text-zinc-500 mb-1">Raise</div>
              <div className="text-2xl text-white mb-0.5">{raise}</div>
              <div className="text-xs text-emerald-400">Target</div>
            </div>

            {/* Revenue / ARR */}
            <div className="rounded-[12px] bg-zinc-800/50 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <div className="text-xs text-zinc-500 mb-1">Revenue</div>
              <div className="text-2xl text-white mb-0.5">{revenue}</div>
              <div className="text-xs text-blue-400">Annual</div>
            </div>

            {/* Growth */}
            <div className="rounded-[12px] bg-zinc-800/50 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <div className="text-xs text-zinc-500 mb-1">Growth</div>
              <div className="text-2xl text-white mb-0.5">{growth}</div>
              <div className="text-xs text-emerald-400">YoY</div>
            </div>

            {/* Customers */}
            <div className="rounded-[12px] bg-zinc-800/50 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <div className="text-xs text-zinc-500 mb-1">Customers</div>
              <div className="text-2xl text-white mb-0.5">{customers}</div>
              <div className="text-xs text-zinc-400">Active</div>
            </div>

            {/* Business Model */}
            <div className="rounded-[12px] bg-zinc-800/50 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <div className="text-xs text-zinc-500 mb-1">Business Model</div>
              <div className="text-2xl text-white mb-0.5">{businessModel}</div>
              <div className="text-xs text-blue-400">Recurring</div>
            </div>

            {/* Deal Type */}
            <div className="rounded-[12px] bg-zinc-800/50 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
              <div className="text-xs text-zinc-500 mb-1">Deal Type</div>
              <div className="text-2xl text-white mb-0.5">{dealType}</div>
              <div className="text-xs text-amber-400">Equity</div>
            </div>

          </div>
        </div>
      </div>

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Left: Deal Summary */}
          <div>
            <h3 className="text-sm text-zinc-400 mb-3">Deal Summary</h3>
            <p className="text-zinc-300 leading-relaxed">{dealSummary}</p>
          </div>

          {/* Right: Confidence */}
          <div className="rounded-[12px] bg-zinc-800/50 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
            <div className="text-xs text-zinc-500 mb-2">Confidence</div>
            <div className="flex items-center justify-between">
              <div className="text-3xl text-white">{confidence}</div>
              <div className="rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.3)]">
                Verified
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
        <h3 className="text-sm text-zinc-400 mb-5">Score Understanding</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Strengths */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />
              <span className="text-xs text-emerald-400">Strengths</span>
            </div>
            <ul className="space-y-2 ml-6">
              {strengthsList.map((strength, index) => (
                <li key={index} className="text-sm text-zinc-300 list-disc">{strength}</li>
              ))}
            </ul>
          </div>

          {/* Weaknesses */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-400" strokeWidth={1.5} />
              <span className="text-xs text-amber-400">Weaknesses</span>
            </div>
            <ul className="space-y-2 ml-6">
              {weaknessesList.map((weakness, index) => (
                <li key={index} className="text-sm text-zinc-300 list-disc">{weakness}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
}

defineProperties(Component, {
  score: {
    label: "Fundamentals Score",
    type: "number",
    control: "slider",
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 48
  },
  dealSummary: {
    label: "Deal Summary",
    type: "string",
    defaultValue: "Series A round for a high-growth SaaS platform with strong revenue traction and expanding customer base across enterprise segments."
  },
  strengths: {
    label: "Strengths (comma-separated)",
    type: "string",
    defaultValue: "Exceptional YoY growth rate, Proven SaaS business model, Strong customer retention"
  },
  weaknesses: {
    label: "Weaknesses (comma-separated)",
    type: "string",
    defaultValue: "Limited market penetration, Early-stage profitability, Competitive landscape risk"
  },
  raise: {
    label: "Raise Amount",
    type: "string",
    defaultValue: "$2.5M"
  },
  revenue: {
    label: "Revenue/ARR",
    type: "string",
    defaultValue: "$1.2M ARR"
  },
  growth: {
    label: "Growth Rate",
    type: "string",
    defaultValue: "220%"
  },
  customers: {
    label: "Customer Count",
    type: "string",
    defaultValue: "180"
  },
  businessModel: {
    label: "Business Model",
    type: "string",
    defaultValue: "SaaS"
  },
  dealType: {
    label: "Deal Type",
    type: "string",
    defaultValue: "Series A"
  },
  confidence: {
    label: "Confidence Level",
    type: "string",
    control: "select",
    options: [
      { value: "High", label: "High" },
      { value: "Medium", label: "Medium" },
      { value: "Low", label: "Low" }
    ],
    defaultValue: "High"
  }
});