import { describe, it, expect } from 'vitest'
import { useSortable } from '../useSortable'

describe('useSortable', () => {
  it('应该正确初始化排序状态', () => {
    const { sortField, sortOrder } = useSortable()
    
    expect(sortField.value).toBe('name')
    expect(sortOrder.value).toBe('asc')
  })

  it('应该正确切换排序字段', () => {
    const { sortField, sortOrder, toggleSort } = useSortable()
    
    // 切换到大小排序
    toggleSort('size')
    expect(sortField.value).toBe('size')
    expect(sortOrder.value).toBe('asc')
    
    // 再次点击同一字段应该切换排序方向
    toggleSort('size')
    expect(sortField.value).toBe('size')
    expect(sortOrder.value).toBe('desc')
  })

  it('应该正确排序文件列表', () => {
    const { sortFiles, toggleSort } = useSortable()
    
    const testFiles = [
      { name: 'zebra.txt', size: 100, isDirectory: false, modifiedTime: new Date('2023-01-01') },
      { name: 'apple.txt', size: 200, isDirectory: false, modifiedTime: new Date('2023-01-02') },
      { name: 'folder1', size: 0, isDirectory: true, modifiedTime: new Date('2023-01-03') },
      { name: 'banana.txt', size: 50, isDirectory: false, modifiedTime: new Date('2023-01-04') }
    ]
    
    // 按名称排序（默认）
    const sortedByName = sortFiles(testFiles)
    expect(sortedByName[0].name).toBe('folder1') // 文件夹在前
    expect(sortedByName[1].name).toBe('apple.txt')
    expect(sortedByName[2].name).toBe('banana.txt')
    expect(sortedByName[3].name).toBe('zebra.txt')
    
    // 按大小排序
    toggleSort('size')
    const sortedBySize = sortFiles(testFiles)
    expect(sortedBySize[0].name).toBe('folder1') // 文件夹始终在前
    expect(sortedBySize[1].name).toBe('banana.txt') // 最小的文件
    expect(sortedBySize[2].name).toBe('zebra.txt')
    expect(sortedBySize[3].name).toBe('apple.txt') // 最大的文件
  })

  it('应该正确显示排序指示器', () => {
    const { getSortIndicator, toggleSort } = useSortable()
    
    // 默认名称升序
    expect(getSortIndicator('name')).toBe('↑')
    expect(getSortIndicator('size')).toBe('')
    
    // 切换到名称降序
    toggleSort('name')
    expect(getSortIndicator('name')).toBe('↓')
    
    // 切换到大小排序
    toggleSort('size')
    expect(getSortIndicator('size')).toBe('↑')
    expect(getSortIndicator('name')).toBe('')
  })

  it('应该正确识别活跃排序字段', () => {
    const { isActiveSort, toggleSort } = useSortable()
    
    // 默认名称排序是活跃的
    expect(isActiveSort('name')).toBe(true)
    expect(isActiveSort('size')).toBe(false)
    
    // 切换到大小排序
    toggleSort('size')
    expect(isActiveSort('name')).toBe(false)
    expect(isActiveSort('size')).toBe(true)
  })
})
