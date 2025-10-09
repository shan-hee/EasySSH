import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import passwordManager from '../services/password-manager';
import log from '../services/log';

export interface ConnectionItem {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  group: string;
  description?: string;
  authType?: 'password' | 'key' | string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

/**
 * 连接管理状态
 */
export const useConnectionStore = defineStore('connection', () => {
  // 连接列表
  const connections = ref<ConnectionItem[]>([]);

  // 搜索关键字
  const searchKeyword = ref<string>('');

  // 分组列表
  const groups = ref<string[]>(['默认分组', '开发服务器', '测试服务器', '生产服务器']);

  // 加密存储相关
  const CONNECTIONS_STORAGE_KEY = 'connections';
  const GROUPS_STORAGE_KEY = 'groups';

  // 初始化标志
  const initialized = ref<boolean>(false);

  /**
   * 初始化连接存储
   * 从加密存储中加载连接数据
   */
  const initializeStore = async (): Promise<boolean> => {
    if (initialized.value) {
      return true;
    }

    try {
      // 检查是否有主密码
      if (!passwordManager.hasMasterPassword()) {
        log.info('未设置主密码，使用默认连接数据');
        initialized.value = true;
        return true;
      }

      // 尝试加载加密的连接数据
      const encryptedConnections = await passwordManager.secureRetrieve(CONNECTIONS_STORAGE_KEY);
      const encryptedGroups = await passwordManager.secureRetrieve(GROUPS_STORAGE_KEY);

      if (encryptedConnections) {
        connections.value = encryptedConnections;
        log.info(`已加载 ${connections.value.length} 个加密连接配置`);
      }

      if (encryptedGroups) {
        groups.value = encryptedGroups;
        log.info(`已加载 ${groups.value.length} 个连接分组`);
      }

      initialized.value = true;
      return true;
    } catch (error) {
      log.error('初始化连接存储失败:', error);
      ElMessage.error('加载连接配置失败，请检查主密码');
      return false;
    }
  };

  /**
   * 保存连接数据到加密存储
   */
  const saveToSecureStorage = async (): Promise<boolean> => {
    try {
      if (!passwordManager.hasMasterPassword()) {
        log.debug('未设置主密码，跳过加密存储');
        return true;
      }

      // 过滤敏感信息，只保存必要的连接数据
      const safeConnections = connections.value.map(conn => ({
        ...conn,
        // 确保密码等敏感信息被正确处理
        password: conn.password || '',
        privateKey: conn.privateKey || ''
      }));

      const connectionsSuccess = await passwordManager.secureStore(
        CONNECTIONS_STORAGE_KEY,
        safeConnections
      );
      const groupsSuccess = await passwordManager.secureStore(GROUPS_STORAGE_KEY, groups.value);

      if (connectionsSuccess && groupsSuccess) {
        log.debug('连接数据已保存到加密存储');
        return true;
      } else {
        log.warn('保存连接数据到加密存储失败');
        return false;
      }
    } catch (error) {
      log.error('保存到加密存储失败:', error);
      return false;
    }
  };

  // 添加连接
  const addConnection = async (connection: Partial<ConnectionItem>): Promise<string | null> => {
    try {
      // 确保存储已初始化
      await initializeStore();

      if (!connection.id) {
        connection.id = Date.now().toString();
      }

      if (!connection.name) {
        connection.name = `${connection.host}:${connection.port}`;
      }

      if (!connection.group) {
        connection.group = '默认分组';
      }

      // 连接创建日期
      connection.createdAt = new Date().toISOString();

      // 设置最后更新日期
      connection.updatedAt = new Date().toISOString();

      // 添加到列表
      connections.value.push(connection as ConnectionItem);

      // 保存到加密存储
      await saveToSecureStorage();

      log.info(`已添加连接: ${connection.name} (${connection.host}:${connection.port})`);
      return connection.id;
    } catch (error) {
      log.error('添加连接失败:', error);
      ElMessage.error('添加连接失败');
      return null;
    }
  };

  // 更新连接
  const updateConnection = async (
    id: string,
    updatedConnection: Partial<ConnectionItem>
  ): Promise<ConnectionItem | null> => {
    try {
      // 确保存储已初始化
      await initializeStore();

      const index = connections.value.findIndex(conn => conn.id === id);
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`);
      }

      // 更新最后修改日期
      updatedConnection.updatedAt = new Date().toISOString();

      // 更新连接信息
      connections.value[index] = { ...connections.value[index], ...updatedConnection };

      // 保存到加密存储
      await saveToSecureStorage();

      log.info(`已更新连接: ${connections.value[index].name}`);
      return connections.value[index];
    } catch (error) {
      log.error('更新连接失败:', error);
      ElMessage.error('更新连接失败');
      return null;
    }
  };

  // 删除连接
  const deleteConnection = async (id: string): Promise<boolean> => {
    try {
      // 确保存储已初始化
      await initializeStore();

      const index = connections.value.findIndex(conn => conn.id === id);
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`);
      }

      const connectionName = connections.value[index].name;

      // 删除连接
      connections.value.splice(index, 1);

      // 保存到加密存储
      await saveToSecureStorage();

      log.info(`已删除连接: ${connectionName}`);
      return true;
    } catch (error) {
      log.error('删除连接失败:', error);
      ElMessage.error('删除连接失败');
      return false;
    }
  };

  // 获取连接信息
  const getConnectionById = (id: string): ConnectionItem | null => {
    try {
      return connections.value.find(conn => conn.id === id) || null;
    } catch (error) {
      log.error('获取连接信息失败', error);
      return null;
    }
  };

  // 筛选连接列表
  const filteredConnections = computed<ConnectionItem[]>(() => {
    if (!searchKeyword.value) {
      return connections.value;
    }

    const keyword = searchKeyword.value.toLowerCase();
    return connections.value.filter(
      conn =>
        conn.name.toLowerCase().includes(keyword) ||
        conn.host.toLowerCase().includes(keyword) ||
        (conn.description && conn.description.toLowerCase().includes(keyword))
    );
  });

  // 按分组获取连接
  const connectionsByGroup = computed<Record<string, ConnectionItem[]>>(() => {
    const result: Record<string, ConnectionItem[]> = {};

    // 初始化所有分组
    groups.value.forEach(group => {
      result[group] = [];
    });

    // 按分组归类连接
    connections.value.forEach(conn => {
      if (!result[conn.group]) {
        result[conn.group] = [];
      }
      result[conn.group].push(conn);
    });

    return result;
  });

  // 添加分组
  const addGroup = (groupName: string): boolean => {
    try {
      if (!groupName || groups.value.includes(groupName)) {
        return false;
      }

      groups.value.push(groupName);
      return true;
    } catch (error) {
      log.error('添加分组失败', error);
      return false;
    }
  };

  // 重命名分组
  const renameGroup = (oldName: string, newName: string): boolean => {
    try {
      if (!oldName || !newName || oldName === newName || groups.value.includes(newName)) {
        return false;
      }

      // 更新分组名称
      const index = groups.value.indexOf(oldName);
      if (index === -1) {
        return false;
      }

      groups.value[index] = newName;

      // 更新连接中的分组信息
      connections.value.forEach(conn => {
        if (conn.group === oldName) {
          conn.group = newName;
        }
      });

      return true;
    } catch (error) {
      log.error('重命名分组失败', error);
      return false;
    }
  };

  // 删除分组
  const deleteGroup = (groupName: string): boolean => {
    try {
      if (!groupName || groupName === '默认分组') {
        return false;
      }

      // 从分组列表中删除
      const index = groups.value.indexOf(groupName);
      if (index === -1) {
        return false;
      }

      groups.value.splice(index, 1);

      // 更新连接中的分组信息，将该分组下的连接移到默认分组
      connections.value.forEach(conn => {
        if (conn.group === groupName) {
          conn.group = '默认分组';
        }
      });

      return true;
    } catch (error) {
      log.error('删除分组失败', error);
      return false;
    }
  };

  // 设置搜索关键字
  const setSearchKeyword = (keyword: string) => {
    searchKeyword.value = keyword;
  };

  // 初始化示例连接（仅开发用途）
  const initExampleConnections = () => {
    if (connections.value.length > 0) {
      return;
    }

    const now = new Date().toISOString();

    const exampleConnections = [
      {
        id: '1',
        name: '本地开发服务器',
        host: 'localhost',
        port: 22,
        username: 'dev',
        authType: 'password',
        password: '',
        group: '开发服务器',
        description: '本地开发环境SSH服务器',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '2',
        name: '测试服务器1',
        host: '192.168.1.100',
        port: 22,
        username: 'test',
        authType: 'password',
        password: '',
        group: '测试服务器',
        description: '测试环境1号服务器',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '3',
        name: '生产服务器',
        host: 'production.example.com',
        port: 22,
        username: 'admin',
        authType: 'key',
        privateKey: '',
        passphrase: '',
        group: '生产服务器',
        description: '生产环境主服务器',
        createdAt: now,
        updatedAt: now
      }
    ];

    connections.value = exampleConnections;
  };

  return {
    connections,
    groups,
    searchKeyword,
    filteredConnections,
    connectionsByGroup,
    initialized,
    initializeStore,
    saveToSecureStorage,
    addConnection,
    updateConnection,
    deleteConnection,
    getConnectionById,
    addGroup,
    renameGroup,
    deleteGroup,
    setSearchKeyword,
    initExampleConnections
  };
});
