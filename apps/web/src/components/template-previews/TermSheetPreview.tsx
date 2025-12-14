import { X, Download } from 'lucide-react';
import { Button } from '../ui/Button';

interface TermSheetPreviewProps {
  isOpen: boolean;
  darkMode: boolean;
  templateName: string;
  onClose: () => void;
}

export function TermSheetPreview({ isOpen, darkMode, templateName, onClose }: TermSheetPreviewProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full h-full max-w-4xl flex flex-col rounded-2xl shadow-2xl overflow-hidden ${
          darkMode ? 'bg-[#18181b]' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}>
          <div>
            <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {templateName}
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Standard Investment Term Sheet
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" darkMode={darkMode} icon={<Download className="w-4 h-4" />}>
              Download PDF
            </Button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className={`max-w-3xl mx-auto ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            <div className={`p-8 rounded-xl border ${
              darkMode ? 'bg-[#27272a]/50 border-white/10' : 'bg-white border-gray-200'
            }`}>
              {/* Header */}
              <div className="text-center mb-8 pb-6 border-b border-current/10">
                <h1 className="text-2xl mb-2">TERM SHEET</h1>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  FOR SERIES [A/B/C] PREFERRED STOCK FINANCING OF
                </p>
                <p className="text-lg mt-2">[COMPANY NAME], INC.</p>
                <p className={`text-xs mt-4 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  [Date]
                </p>
                <p className={`text-xs mt-2 ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                  CONFIDENTIAL - THIS TERM SHEET IS NON-BINDING
                </p>
              </div>

              {/* Summary of Terms */}
              <div className="mb-6">
                <h2 className="text-lg mb-4 text-[#6366f1]">SUMMARY OF TERMS</h2>
                
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Issuer</p>
                    <p className="text-sm">[Company Name], Inc., a Delaware corporation (the "Company")</p>
                  </div>

                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Investors</p>
                    <p className="text-sm">[Lead Investor Name] ("Lead Investor") and other investors acceptable to the Company and the Lead Investor (collectively, the "Investors")</p>
                  </div>

                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Amount of Financing</p>
                    <p className="text-sm">An aggregate of $[X] million (the "Financing")</p>
                  </div>

                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Pre-Money Valuation</p>
                    <p className="text-sm">$[X] million</p>
                  </div>

                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Price Per Share</p>
                    <p className="text-sm">$[X.XX] per share (the "Original Purchase Price")</p>
                  </div>

                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Type of Security</p>
                    <p className="text-sm">Series [A/B/C] Preferred Stock (the "Series [A] Preferred")</p>
                  </div>

                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'}`}>
                    <p className="text-xs mb-2 opacity-60">Closing Date</p>
                    <p className="text-sm">As soon as practicable following the Company's and Investors' acceptance of this term sheet and satisfaction of the Conditions to Closing (the "Closing")</p>
                  </div>
                </div>
              </div>

              {/* Key Terms */}
              <div className="mb-6">
                <h2 className="text-lg mb-4 text-[#6366f1]">KEY TERMS</h2>

                <div className="space-y-4 text-sm">
                  <div>
                    <h3 className="mb-2">1. Liquidation Preference</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      In the event of any liquidation, dissolution or winding up of the Company, the holders of the Series [A] Preferred shall be entitled to receive, in preference to holders of Common Stock, an amount equal to [1x/2x/3x] the Original Purchase Price plus declared but unpaid dividends (the "Liquidation Preference").
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">2. Participation</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      [Non-participating / Participating with [X]x cap] - After payment of the Liquidation Preference, the remaining assets shall be distributed pro rata to holders of Common Stock [and Series [A] Preferred on an as-converted basis].
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">3. Conversion</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Each share of Series [A] Preferred is convertible at any time, at the option of the holder, into shares of Common Stock. The initial conversion rate shall be 1:1, subject to anti-dilution adjustments as provided below.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">4. Anti-Dilution Protection</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      [Broad-based weighted average / Narrow-based weighted average / Full ratchet] anti-dilution protection in the event of down rounds, excluding certain exempt issuances.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">5. Voting Rights</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      The Series [A] Preferred shall vote together with the Common Stock on an as-converted basis, and not as a separate class, except as required by law or as set forth below.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">6. Protective Provisions</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Consent of holders of [majority/supermajority] of Series [A] Preferred required for: (i) sale of the Company, (ii) changes to certificate of incorporation, (iii) creation of new senior securities, (iv) payment of dividends, (v) redemption of shares, and (vi) increase/decrease authorized shares.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">7. Board of Directors</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      The Board shall consist of [5/7] members: [X] designated by Common shareholders (including founders), [X] designated by Series [A] investors, and [X] independent members mutually agreed upon.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">8. Information Rights</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      The Company shall provide investors with: (i) annual audited financial statements, (ii) monthly/quarterly unaudited financial statements, (iii) annual budgets, and (iv) other information reasonably requested.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">9. Founder Vesting</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      [X]% of founder shares shall be subject to vesting over [4] years, with a [1]-year cliff. Acceleration provisions to be negotiated.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">10. Employee Option Pool</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Prior to Closing, the Company shall reserve [15-20]% of its fully-diluted capitalization for issuances to employees, directors, and consultants.
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">11. Drag-Along Rights</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      The holders of Preferred Stock and Common Stock shall enter into a drag-along agreement requiring all stockholders to approve a sale of the Company if approved by [Board and majority of Preferred].
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2">12. Pro Rata Rights</h3>
                    <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Investors shall have the right to participate in future equity financings to maintain their percentage ownership, subject to customary exceptions.
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className={`pt-6 mt-6 border-t text-xs ${darkMode ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-600'}`}>
                <p className="mb-2">
                  <strong>Confidentiality:</strong> This term sheet is confidential and for discussion purposes only.
                </p>
                <p className="mb-2">
                  <strong>Non-Binding:</strong> Except for Exclusivity and Confidentiality provisions, this term sheet is non-binding.
                </p>
                <p className="mb-2">
                  <strong>Exclusivity:</strong> The Company agrees to work exclusively with the Investors for [30/45/60] days.
                </p>
                <p className="mb-2">
                  <strong>Expenses:</strong> Each party shall bear its own legal and other expenses. The Company shall pay reasonable legal fees of Lead Investor up to $[X].
                </p>
                <p className="mt-4">
                  <strong>Expiration:</strong> This term sheet expires if not accepted by [Date].
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
