/**
 * Debug Logger for Mock Data Detection
 * 
 * This utility helps identify which data is hardcoded (mock) vs. fetched from API
 * Logs appear in Chrome DevTools Console with color-coded output
 * 
 * Enable in Chrome Console:
 * - localStorage.setItem('DEBUG_MOCK_DATA', 'true')
 * 
 * Disable:
 * - localStorage.removeItem('DEBUG_MOCK_DATA')
 */

type DataSource = 'API' | 'MOCK' | 'FALLBACK' | 'COMPUTED';
type LogLevel = 'info' | 'warn' | 'error' | 'success';

interface DataLog {
  timestamp: string;
  component: string;
  field: string;
  value: any;
  source: DataSource;
  details?: string;
}

class MockDataDebugger {
  private enabled: boolean = false;
  private logs: DataLog[] = [];
  private readonly MAX_LOGS = 1000;

  constructor() {
    this.enabled = localStorage.getItem('DEBUG_MOCK_DATA') === 'true';
    this.setupStorageListener();
    this.logToConsole('DEBUG_MOCK_DATA_ENABLED', {
      message: 'Mock Data Debugger initialized',
      enabled: this.enabled,
      instructions: 'Use localStorage.setItem("DEBUG_MOCK_DATA", "true/false") to toggle'
    }, 'info');
  }

  private setupStorageListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'DEBUG_MOCK_DATA') {
        this.enabled = e.newValue === 'true';
        this.logToConsole('DEBUG_TOGGLE', {
          message: 'Debug mode toggled',
          enabled: this.enabled
        }, 'info');
      }
    });
  }

  private getColor(source: DataSource): string {
    const colors = {
      'API': '#4CAF50',      // Green - real data
      'MOCK': '#f44336',     // Red - hardcoded mock data
      'FALLBACK': '#FF9800', // Orange - fallback/placeholder
      'COMPUTED': '#2196F3'  // Blue - calculated values
    };
    return colors[source];
  }

  private getConsoleStyle(source: DataSource, level: LogLevel): string {
    const color = this.getColor(source);
    return `color: white; background-color: ${color}; padding: 4px 8px; border-radius: 3px; font-weight: bold;`;
  }

  private logToConsole(
    component: string,
    data: any,
    level: LogLevel = 'info'
  ) {
    if (!this.enabled && level === 'info') return;

    const timestamp = new Date().toISOString();
    const logData = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

    console.log(
      `%c[${timestamp}] ${component}`,
      this.getConsoleStyle('COMPUTED', level),
      logData
    );
  }

  /**
   * Log API data being received
   * @param component Component name (e.g., 'DealWorkspace')
   * @param field Field name (e.g., 'dealInfo')
   * @param value The actual data received
   * @param details Optional details about the API call
   */
  logAPIData(
    component: string,
    field: string,
    value: any,
    details?: string
  ) {
    if (!this.enabled) return;

    const log: DataLog = {
      timestamp: new Date().toISOString(),
      component,
      field,
      value,
      source: 'API',
      details
    };

    this.logs.push(log);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    console.group(
      `%c✓ API DATA: ${component}.${field}`,
      this.getConsoleStyle('API', 'success')
    );
    console.log('Value:', value);
    if (details) console.log('Details:', details);
    console.log('Timestamp:', log.timestamp);
    console.groupEnd();
  }

  /**
   * Log hardcoded/mock data
   * @param component Component name
   * @param field Field name
   * @param value The hardcoded value
   * @param details Why this is hardcoded
   */
  logMockData(
    component: string,
    field: string,
    value: any,
    details?: string
  ) {
    if (!this.enabled) return;

    const log: DataLog = {
      timestamp: new Date().toISOString(),
      component,
      field,
      value,
      source: 'MOCK',
      details
    };

    this.logs.push(log);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    console.group(
      `%c⚠ MOCK DATA: ${component}.${field}`,
      this.getConsoleStyle('MOCK', 'warn')
    );
    console.warn('⚠️ This data is hardcoded, not from API');
    console.log('Value:', value);
    if (details) console.log('Details:', details);
    console.log('Timestamp:', log.timestamp);
    console.groupEnd();
  }

  /**
   * Log fallback/placeholder data
   * @param component Component name
   * @param field Field name
   * @param value The fallback value
   * @param details Why fallback was used
   */
  logFallbackData(
    component: string,
    field: string,
    value: any,
    details?: string
  ) {
    if (!this.enabled) return;

    const log: DataLog = {
      timestamp: new Date().toISOString(),
      component,
      field,
      value,
      source: 'FALLBACK',
      details
    };

    this.logs.push(log);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    console.group(
      `%c○ FALLBACK: ${component}.${field}`,
      this.getConsoleStyle('FALLBACK', 'warn')
    );
    console.log('Value:', value);
    if (details) console.log('Reason:', details);
    console.log('Timestamp:', log.timestamp);
    console.groupEnd();
  }

  /**
   * Log computed/calculated data
   * @param component Component name
   * @param field Field name
   * @param value The computed value
   * @param computation Description of computation
   */
  logComputedData(
    component: string,
    field: string,
    value: any,
    computation?: string
  ) {
    if (!this.enabled) return;

    const log: DataLog = {
      timestamp: new Date().toISOString(),
      component,
      field,
      value,
      source: 'COMPUTED',
      details: computation
    };

    this.logs.push(log);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    console.group(
      `%c◆ COMPUTED: ${component}.${field}`,
      this.getConsoleStyle('COMPUTED', 'info')
    );
    console.log('Value:', value);
    if (computation) console.log('Computation:', computation);
    console.log('Timestamp:', log.timestamp);
    console.groupEnd();
  }

  /**
   * Get summary of all logged data
   */
  getSummary() {
    if (!this.enabled) {
      console.log('Debug mode disabled. Enable with: localStorage.setItem("DEBUG_MOCK_DATA", "true")');
      return;
    }

    const summary = {
      total: this.logs.length,
      bySource: {
        API: this.logs.filter(l => l.source === 'API').length,
        MOCK: this.logs.filter(l => l.source === 'MOCK').length,
        FALLBACK: this.logs.filter(l => l.source === 'FALLBACK').length,
        COMPUTED: this.logs.filter(l => l.source === 'COMPUTED').length
      },
      byComponent: {} as Record<string, number>,
      logs: this.logs
    };

    this.logs.forEach(log => {
      summary.byComponent[log.component] = (summary.byComponent[log.component] || 0) + 1;
    });

    console.group('%c📊 DATA SOURCE SUMMARY', 'color: white; background-color: #2196F3; padding: 8px 12px; border-radius: 3px; font-weight: bold;');
    console.table(summary.bySource);
    console.log('By Component:', summary.byComponent);
    console.log('Full Logs:', summary.logs);
    console.groupEnd();

    return summary;
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
    console.log('%c✓ Logs cleared', 'color: green;');
  }

  /**
   * Get all logs for a specific component
   */
  getComponentLogs(component: string) {
    return this.logs.filter(l => l.component === component);
  }

  /**
   * Get all mock data logs
   */
  getMockDataLogs() {
    return this.logs.filter(l => l.source === 'MOCK');
  }

  /**
   * Export logs as JSON
   */
  exportLogs() {
    const dataStr = JSON.stringify(this.logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mock-data-logs-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

// Export singleton instance
export const debugLogger = new MockDataDebugger();

// Make available globally for Chrome Console access
declare global {
  interface Window {
    debugLogger: MockDataDebugger;
  }
}

if (typeof window !== 'undefined') {
  window.debugLogger = debugLogger;
}
