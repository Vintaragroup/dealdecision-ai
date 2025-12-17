# Mock Data Debug Logger

## Quick Start

### Enable in Chrome DevTools Console:
```javascript
localStorage.setItem('DEBUG_MOCK_DATA', 'true')
```

### Disable:
```javascript
localStorage.removeItem('DEBUG_MOCK_DATA')
```

## What You'll See

Once enabled, the console will show color-coded logs:

- 🟢 **GREEN**: Data from API (real data)
- 🔴 **RED**: Hardcoded mock data (should be removed)
- 🟠 **ORANGE**: Fallback/placeholder data (shown when API data missing)
- 🔵 **BLUE**: Computed/calculated values

## Available Commands in Chrome Console

```javascript
// View summary of all data sources
debugLogger.getSummary()

// Get all logs for a specific component
debugLogger.getComponentLogs('DealWorkspace')

// Get only the mock data logs
debugLogger.getMockDataLogs()

// Export all logs as JSON file
debugLogger.exportLogs()

// Clear all logs
debugLogger.clearLogs()

// Check if debug is enabled
localStorage.getItem('DEBUG_MOCK_DATA')
```

## Example Output

When you navigate to a deal workspace with debugging enabled, you'll see:

```
✓ API DATA: DealWorkspace.dealInfo
├─ Value: {name: "Acme Corp", score: 87, ...}
├─ Details: Fetched from apiGetDeal()
└─ Timestamp: 2025-12-16T10:30:45.123Z

⚠ MOCK DATA: DealWorkspace.investorScore
├─ Value: 82 (now 0 after fixes)
├─ Details: Hardcoded default value
└─ Timestamp: 2025-12-16T10:30:45.456Z

○ FALLBACK: DealWorkspace.description
├─ Value: "No description provided"
├─ Reason: dealInfo?.description was null
└─ Timestamp: 2025-12-16T10:30:45.789Z

◆ COMPUTED: DealWorkspace.displayScore
├─ Value: 87
├─ Computation: typeof dealInfo?.score === 'number' ? dealInfo.score : investorScore
└─ Timestamp: 2025-12-16T10:30:45.999Z
```

## Integration with Components

To use in any component:

```typescript
import { debugLogger } from '../../lib/debugLogger';

// Log API data received
debugLogger.logAPIData('ComponentName', 'fieldName', apiData, 'Fetched from apiGetDeal()');

// Log mock data (if found)
debugLogger.logMockData('ComponentName', 'fieldName', hardcodedValue, 'Hardcoded default');

// Log fallback data
debugLogger.logFallbackData('ComponentName', 'fieldName', fallbackValue, 'API returned null');

// Log computed values
debugLogger.logComputedData('ComponentName', 'fieldName', computedValue, 'Calculation logic here');
```

## Current Status

- ✅ Logger created and ready to use
- ⏳ Integration with components pending (add logging calls as needed)
- 📊 Summary dashboard available via `debugLogger.getSummary()`

## How It Works

1. When you set `DEBUG_MOCK_DATA` to `true`, the logger enables
2. Each component logs data sources as it's used
3. Logs are color-coded by type (API, MOCK, FALLBACK, COMPUTED)
4. All logs stored in memory (up to 1000 entries)
5. Full logs available via Chrome Console commands

## Performance Note

Debug logging is disabled by default (opt-in). When disabled, no logging overhead is incurred.
