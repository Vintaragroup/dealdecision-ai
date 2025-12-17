# Chrome DevTools Console - Mock Data Debug Guide

## Quick Start in Chrome

1. **Open Chrome DevTools**: F12 or Right-click → Inspect → Console tab

2. **Enable debugging** by pasting:
   ```javascript
   localStorage.setItem('DEBUG_MOCK_DATA', 'true')
   ```

3. **Reload the page** (F5 or Cmd+R)

4. **Navigate to a deal workspace** - you'll see color-coded logs!

---

## Log Colors and Meanings

| Color | Meaning | Example |
|-------|---------|---------|
| **🟢 GREEN** | Real data from API | dealInfo from `apiGetDeal()` |
| **🔴 RED** | Hardcoded mock data (bad!) | "Nov 15, 2024" hardcoded string |
| **🟠 ORANGE** | Placeholder/fallback text | "N/A" or "Not available" |
| **🔵 BLUE** | Calculated/derived values | displayScore computed from API |

---

## Console Commands

### View Summary
```javascript
debugLogger.getSummary()
```
Shows count of: API data, mock data, fallbacks, computed values (grouped by component)

### Get Component Logs
```javascript
debugLogger.getComponentLogs('DealWorkspace')
```
Shows all logs from a specific component

### Find All Mock Data
```javascript
debugLogger.getMockDataLogs()
```
Returns array of all hardcoded values found - use this to identify remaining mock data

### Export for Analysis
```javascript
debugLogger.exportLogs()
```
Downloads a JSON file with all logs - great for sharing with team

### Clear Logs
```javascript
debugLogger.clearLogs()
```
Removes all logged data from memory

---

## What You'll See in Console

When you navigate to a deal workspace:

```
✓ API DATA: DealWorkspace.dealFromApi
  Value: {name: "Acme Corp", score: 87, stage: "Series A", ...}
  Details: Fetched via apiGetDeal(deal-123)
  Timestamp: 2025-12-16T10:30:45.123Z

○ FALLBACK: DealWorkspace.displayScore
  Value: 0
  Reason: No API score available, using fallback investorScore (0)
  Timestamp: 2025-12-16T10:30:45.456Z
```

---

## Integration Status

- ✅ Debug Logger created: `apps/web/src/lib/debugLogger.ts`
- ✅ DealWorkspace integrated with logger
- ✅ API data logging: `apiGetDeal()` calls logged as `✓ API DATA`
- ✅ Fallback score logging: `investorScore` fallback logged as `○ FALLBACK`
- ✅ Ready to use!

---

## Example Workflow

1. Open DevTools Console (F12)

2. Enable debugging:
   ```javascript
   localStorage.setItem('DEBUG_MOCK_DATA', 'true')
   ```

3. Reload page (F5)

4. Click on a deal in the pipeline

5. Watch the Console tab - you'll see:
   - 🟢 GREEN logs when API data arrives
   - 🟠 ORANGE logs when fallbacks are used
   - 🔴 RED logs if any mock data is still in code

6. Run this to see summary:
   ```javascript
   debugLogger.getSummary()
   ```

7. Find all remaining hardcoded values:
   ```javascript
   debugLogger.getMockDataLogs()
   ```

8. Export for team review:
   ```javascript
   debugLogger.exportLogs()
   ```

---

## Disable When Done

```javascript
localStorage.removeItem('DEBUG_MOCK_DATA')
```

Or:

```javascript
localStorage.setItem('DEBUG_MOCK_DATA', 'false')
```

---

## Key Features

- **Zero Overhead**: No performance impact when disabled
- **Color-Coded**: Easy to spot API data (green) vs mock (red) vs fallback (orange)
- **Timestamped**: Every log entry includes when it occurred
- **Grouped**: Console groups related logs together for readability
- **Exportable**: Download logs as JSON for analysis and sharing
- **In-Memory Storage**: Tracks up to 1000 log entries per session

---

## What This Solves

Before: No visibility into which data was API vs hardcoded
```
DealWorkspace shows "Nov 15, 2024" - is it from API? No idea.
Score shows 82 - real data or hardcoded? Can't tell.
```

After: Crystal clear visibility in Chrome console
```
🟠 FALLBACK: investorScore = 82 (No API score available)
✓ API DATA: dealInfo.createdDate = "2025-01-15" (From API)
```

---

## Next Steps

1. **Test the logger**: Navigate to a deal, open DevTools Console, enable logging
2. **Check the summary**: Run `debugLogger.getSummary()` to see data sources
3. **Find remaining issues**: Run `debugLogger.getMockDataLogs()` to identify hardcoded values
4. **Export results**: Run `debugLogger.exportLogs()` to share findings

---

*Last Updated: 2025-01-16*
*Created alongside comprehensive mock data removal and API integration audit*
