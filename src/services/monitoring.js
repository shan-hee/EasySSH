/**
 * 监控WebSocket客户端服务
 * 用于连接到服务器的监控WebSocket
 * 
 * 注意：此文件现在是代理模式的入口点
 * 实际实现已迁移到monitoringFactory和monitoringProxy
 */

// 导入代理实现
import monitoringServiceProxy from './monitoringProxy';

// 初始化代理服务
monitoringServiceProxy.init();

// 重新导出代理服务，保持向后兼容性
export default monitoringServiceProxy; 