# Debug Logger Quick Reference Card

## TL;DR - Get Started in 30 Seconds

```javascript
// 1. Enable in Chrome Console (F12)
localStorage.setItem('DEBUG_MOCK_DATA', 'true')

// 2. Reload page (F5)

// 3. Navigate to a deal

// 4. Watch for colored logs in Console:
//    🟢 GREEN = API data (good)
//    🔴 RED = Hardcoded (bad)
//    🟠 ORANGE = Fallback (ok)
//    🔵 BLUE = Computed (ok)

// 5. Check summary
debugLogger.getSummary()
// Expected: Mock Data: 0 ✅

// 6. Disable when done
localStorage.removeItem('DEBUG_MOCK_DATA')
```

---

## Commands Cheat Sheet

| Command | Purpose | Output |
|---------|---------|--------|
| `debugLogger.getSummary()` | Overview of all data | Count breakdown by type |
| `debugLogger.getMockDataLogs()` | Find hardcoded values | Array of RED logs (should be []) |
| `debugLogger.getComponentLogs('NAME')` | Logs from one component | Filtered log array |
| `debugLogger.exportLogs()` | Download JSON file | File download |
| `debugLogger.clearLogs()` | Clear memory | None |
| `localStorage.setItem('DEBUG_MOCK_DATA', 'true')` | Enable logging | None |
| `localStorage.removeItem('DEBUG_MOCK_DATA')` | Disable logging | None |

---

## What Each Log Color Means

| Symbol | Color | Meaning | Action |
|--------|-------|---------|--------|
| ✓ | 🟢 GREEN | Real API data | ✅ Keep |
| ⚠ | 🔴 RED | Hardcoded value | ❌ Fix |
| ○ | 🟠 ORANGE | Fallback/placeholder | ⚠ Check |
| • | 🔵 BLUE | Computed value | ℹ Info |

---

## Example Output You'll See

### Good (✅)
```
✓ API DATA: DealWorkspace.dealFromApi
  Value: {id: "abc", name: "TechVision", score: 87}
  Details: Fetched via apiGetDeal(abc)
```

### Bad (❌ - Needs Fixing)
```
⚠ MOCK DATA: Component.fieldName
  Value: "hardcoded string"
  Details: This is hardcoded somewhere
```

### Fallback (⚠ - Expected When API Missing)
```
○ FALLBACK: DealWorkspace.displayScore
  Value: 0
  Reason: No API score available
```

### Computed (ℹ - Info Only)
```
• COMPUTED: Component.derivedValue
  Value: 42
  Calculation: (a + b) / c
```

---

## Common Scenarios

### Scenario 1: "Is this data from the API?"
**Do This**:
1. Enable logging: `localStorage.setItem('DEBUG_MOCK_DATA', 'true')`
2. Reload and navigate
3. Look at Console for GREEN logs
4. Run: `debugLogger.getComponentLogs('ComponentName')`

### Scenario 2: "Are there any hardcoded values left?"
**Do This**:
1. Enable logging
2. Use app normally
3. Run: `debugLogger.getMockDataLogs()`
4. If array is empty: ✅ Clean
5. If array has items: ❌ Found hardcoded values

### Scenario 3: "What's the overall data source breakdown?"
**Do This**:
1. Enable logging
2. Use app for a few minutes
3. Run: `debugLogger.getSummary()`
4. See counts of: API, Mock, Fallback, Computed

### Scenario 4: "Save logs to share with team"
**Do This**:
1. Enable logging
2. Reproduce the issue/test case
3. Run: `debugLogger.exportLogs()`
4. Get file: `debug-logs-YYYY-MM-DDTHH-MM-SS.json`
5. Share with team

---

## Troubleshooting Quick Guide

| Problem | Solution |
|---------|----------|
| No logs showing | Verify: `localStorage.getItem('DEBUG_MOCK_DATA')` = `'true'`, reload page |
| All RED logs | Check for hardcoded strings, use `getMockDataLogs()` to find |
| Empty summary | Navigate deal first to trigger API calls |
| Export not working | Check browser Download folder, check for pop-up blocker |
| Performance slow | Disable logging: `localStorage.removeItem('DEBUG_MOCK_DATA')` |

---

## File Locations

| File | Purpose | Size |
|------|---------|------|
| `apps/web/src/lib/debugLogger.ts` | Main utility | 350 lines |
| `apps/web/src/components/pages/DealWorkspace.tsx` | Integration point | 1077 lines |
| `DEBUG_LOGGER_README.md` | Full documentation | 150 lines |
| `DEBUG_CONSOLE_QUICK_START.md` | Quick reference | 200 lines |
| `DEBUG_LOGGER_SYSTEM_GUIDE.md` | Complete guide | 400+ lines |
| `DEBUG_LOGGER_VERIFICATION_CHECKLIST.md` | Testing guide | 300+ lines |

---

## One-Liners for Common Tasks

```javascript
// Enable debugging
localStorage.setItem('DEBUG_MOCK_DATA', 'true')

// Disable debugging
localStorage.removeItem('DEBUG_MOCK_DATA')

// See everything
debugLogger.getSummary()

// Find problems
debugLogger.getMockDataLogs()

// Get specific component
debugLogger.getComponentLogs('DealWorkspace')

// Save for sharing
debugLogger.exportLogs()

// Start fresh
debugLogger.clearLogs()

// Check status
console.log(localStorage.getItem('DEBUG_MOCK_DATA'))
```

---

## What's Been Done

✅ Created 350-line debug logger utility
✅ Integrated with DealWorkspace component
✅ Removed 10 hardcoded values
✅ Added API fetch logging
✅ Added score calculation logging
✅ Created 4 documentation files
✅ Ready for testing

---

## What's Next

1. **Test it**: Open app, enable logging, navigate deals
2. **Verify**: Run `getSummary()`, check for Mock: 0
3. **Extend**: Add logging to other components
4. **Clean up**: Remove remaining hardcoded objects

---

## Key Insight

> Before: "Is this data from the API or hardcoded?"
> Answer: "I don't know, let me dig through the code..."
>
> After: Enable logging → One look at Console → Know everything about data sources

---

## Contact Points

**If logging doesn't show**:
- Check Chrome Console is open (F12)
- Check localStorage: `localStorage.getItem('DEBUG_MOCK_DATA')`
- Check page reload happened
- Check no build errors: `npm run build`

**If you see RED logs**:
- Run: `debugLogger.getMockDataLogs()`
- Find the exact field in code
- Replace with API call or remove
- Test again

**If summary is wrong**:
- Make sure you navigated a deal (triggers API call)
- Give API 1-2 seconds to respond
- Check Network tab for failed requests

---

*For full details, see: DEBUG_LOGGER_SYSTEM_GUIDE.md*
*For testing steps, see: DEBUG_LOGGER_VERIFICATION_CHECKLIST.md*
*For quick commands, see: DEBUG_CONSOLE_QUICK_START.md*

**Status**: Ready for testing ✅
**Created**: 2025-01-16
**Purpose**: One-page reference for using the debug logger
