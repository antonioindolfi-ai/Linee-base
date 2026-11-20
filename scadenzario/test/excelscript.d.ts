// Definizioni minime dell'API degli Office Scripts usata da estrai-scadenze.ts (stesse firme della documentazione Microsoft).
declare namespace ExcelScript {
  interface Workbook {
    getTable(key: string): Table | undefined;
    getWorksheet(name: string): Worksheet | undefined;
    addWorksheet(name?: string): Worksheet;
  }
  interface Worksheet {
    getRangeByIndexes(startRow: number, startColumn: number, rowCount: number, columnCount: number): Range;
    addTable(address: Range | string, hasHeaders: boolean): Table;
  }
  interface Range {
    getValues(): (string | number | boolean)[][];
    setValues(values: (string | number | boolean)[][]): void;
  }
  interface Table {
    setName(name: string): void;
    getRowCount(): number;
    getRangeBetweenHeaderAndTotal(): Range;
    getColumnByName(key: string): TableColumn | undefined;
    addRows(index?: number, values?: (string | number | boolean)[][]): void;
  }
  interface TableColumn {
    getRangeBetweenHeaderAndTotal(): Range;
  }
}
