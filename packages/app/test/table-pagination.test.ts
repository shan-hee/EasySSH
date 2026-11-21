import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_TABLE_PAGE_SIZE,
  MAX_TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
} from "../src/lib/table-pagination"
import {
  defaultAuditLogListParams,
  defaultOperationRecordListParams,
  defaultTaskCenterListParams,
  scriptsListQueryOptions,
} from "../src/lib/dashboard-query-options"

test("shared table pagination constants use 100 default and 25..500 options", () => {
  assert.equal(DEFAULT_TABLE_PAGE_SIZE, 100)
  assert.equal(MAX_TABLE_PAGE_SIZE, 500)
  assert.deepEqual([...TABLE_PAGE_SIZE_OPTIONS], [25, 50, 100, 250, 500])
})

test("dashboard table query defaults all match DEFAULT_TABLE_PAGE_SIZE", () => {
  assert.equal(defaultAuditLogListParams.page_size, DEFAULT_TABLE_PAGE_SIZE)
  assert.equal(defaultOperationRecordListParams.page_size, DEFAULT_TABLE_PAGE_SIZE)
  assert.equal(defaultTaskCenterListParams.page_size, DEFAULT_TABLE_PAGE_SIZE)

  const scriptsOptions = scriptsListQueryOptions(undefined, undefined, {
    list: async () => ({
      data: [],
      total: 0,
      page: 1,
      page_size: DEFAULT_TABLE_PAGE_SIZE,
      total_pages: 1,
    }),
  })
  assert.deepEqual(scriptsOptions.queryKey, ["scripts", "list", 1, DEFAULT_TABLE_PAGE_SIZE])
})
