/**
 * 连接控制器
 * 处理连接相关的API请求
 */

const logger = require('../utils/logger');
const db = require('../config/database').getDb();
const { validateConnection } = require('../utils/validators');
const { processConnectionSensitiveData, decryptPassword, decryptPrivateKey } = require('../utils/encryption');

/**
 * 获取用户的所有连接
 */
const getUserConnections = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 从数据库获取用户连接
    const connections = db.prepare(
      'SELECT * FROM connections WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId);
    
    // 处理连接数据，将存储的JSON字符串转为对象，并解密敏感信息
    const formattedConnections = connections.map(conn => {
      try {
        // 可能包含额外配置的JSON字段
        if (conn.config) {
          conn.config = JSON.parse(conn.config);
        }

        // 解密敏感数据（仅在需要时）
        const decryptedConn = { ...conn };
        if (decryptedConn.password && decryptedConn.remember_password) {
          decryptedConn.password = decryptPassword(decryptedConn.password);
        }
        if (decryptedConn.privateKey) {
          decryptedConn.privateKey = decryptPrivateKey(decryptedConn.privateKey);
        }
        if (decryptedConn.passphrase) {
          decryptedConn.passphrase = decryptPassword(decryptedConn.passphrase);
        }

        return {
          id: decryptedConn.id,
          name: decryptedConn.name,
          host: decryptedConn.host,
          port: decryptedConn.port,
          username: decryptedConn.username,
          password: decryptedConn.remember_password ? decryptedConn.password : '',
          rememberPassword: !!decryptedConn.remember_password,
          privateKey: decryptedConn.privateKey || '',
          passphrase: decryptedConn.passphrase || '',
          authType: decryptedConn.auth_type || 'password',
          description: decryptedConn.description || '',
          group: decryptedConn.group_name || '默认分组',
          config: decryptedConn.config || {},
          createdAt: decryptedConn.created_at,
          updatedAt: decryptedConn.updated_at
        };
      } catch (err) {
        logger.error(`处理连接数据错误：${err.message}`, { connectionId: conn.id });
        return null;
      }
    }).filter(conn => conn !== null);
    
    res.json({
      success: true,
      connections: formattedConnections
    });
  } catch (error) {
    logger.error('获取用户连接失败', error);
    res.status(500).json({
      success: false,
      message: '获取连接列表失败',
      error: error.message
    });
  }
};

/**
 * 添加新连接
 */
const addConnection = async (req, res) => {
  try {
    const userId = req.user.id;
    const connection = req.body.connection;
    
    // 验证连接数据
    if (!validateConnection(connection)) {
      return res.status(400).json({
        success: false,
        message: '连接数据格式不正确'
      });
    }
    
    // 检查是否已存在相同的连接（防重复）
    const existingConnection = db.prepare(
      'SELECT id FROM connections WHERE host = ? AND port = ? AND username = ? AND user_id = ?'
    ).get(connection.host, connection.port || 22, connection.username, userId);

    if (existingConnection) {
      return res.status(409).json({
        success: false,
        message: '相同的连接已存在',
        existingConnectionId: existingConnection.id
      });
    }

    // 生成新的连接ID
    const connectionId = Date.now().toString();

    // 准备要插入的数据
    const now = new Date().toISOString();

    // 开始事务
    db.prepare('BEGIN TRANSACTION').run();

    try {
    // 加密敏感数据
    const encryptedConnection = processConnectionSensitiveData(connection, true);

    // 插入新连接
    db.prepare(
      `INSERT INTO connections (
        id, user_id, name, host, port, username, password,
        remember_password, privateKey, passphrase, auth_type,
        description, group_name, config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      connectionId,
      userId,
      encryptedConnection.name || `${encryptedConnection.username}@${encryptedConnection.host}`,
      encryptedConnection.host,
      encryptedConnection.port || 22,
      encryptedConnection.username,
      encryptedConnection.rememberPassword ? encryptedConnection.password : '',
      encryptedConnection.rememberPassword ? 1 : 0,
      encryptedConnection.privateKey || '',
      encryptedConnection.passphrase || '',
      encryptedConnection.authType || 'password',
      encryptedConnection.description || '',
      encryptedConnection.group || '默认分组',
      JSON.stringify(encryptedConnection.config || {}),
      now,
      now
    );
      
      // 提交事务
      db.prepare('COMMIT').run();
    
    res.json({
      success: true,
      connectionId,
      message: '连接添加成功'
    });
    } catch (error) {
      // 回滚事务
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    logger.error('添加连接失败', error);
    res.status(500).json({
      success: false,
      message: '添加连接失败',
      error: error.message
    });
  }
};

/**
 * 更新连接
 */
const updateConnection = async (req, res) => {
  try {
    const userId = req.user.id;
    const connectionId = req.params.id;
    const connection = req.body.connection;
    
    // 验证连接数据
    if (!validateConnection(connection)) {
      return res.status(400).json({
        success: false,
        message: '连接数据格式不正确'
      });
    }
    
    // 检查连接是否存在并属于当前用户
    const existingConnection = db.prepare(
      'SELECT id FROM connections WHERE id = ? AND user_id = ?'
    ).get(connectionId, userId);
    
    if (!existingConnection) {
      return res.status(404).json({
        success: false,
        message: '未找到指定连接或无权限修改'
      });
    }
    
    // 更新连接
    const now = new Date().toISOString();

    // 加密敏感数据
    const encryptedConnection = processConnectionSensitiveData(connection, true);

    db.prepare(
      `UPDATE connections SET
        name = ?,
        host = ?,
        port = ?,
        username = ?,
        password = ?,
        remember_password = ?,
        privateKey = ?,
        passphrase = ?,
        auth_type = ?,
        description = ?,
        group_name = ?,
        config = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?`
    ).run(
      encryptedConnection.name || `${encryptedConnection.username}@${encryptedConnection.host}`,
      encryptedConnection.host,
      encryptedConnection.port || 22,
      encryptedConnection.username,
      encryptedConnection.rememberPassword ? encryptedConnection.password : '',
      encryptedConnection.rememberPassword ? 1 : 0,
      encryptedConnection.privateKey || '',
      encryptedConnection.passphrase || '',
      encryptedConnection.authType || 'password',
      encryptedConnection.description || '',
      encryptedConnection.group || '默认分组',
      JSON.stringify(connection.config || {}),
      now,
      connectionId,
      userId
    );
    
    res.json({
      success: true,
      message: '连接更新成功'
    });
  } catch (error) {
    logger.error('更新连接失败', error);
    res.status(500).json({
      success: false,
      message: '更新连接失败',
      error: error.message
    });
  }
};

/**
 * 删除连接
 */
const deleteConnection = async (req, res) => {
  try {
    const userId = req.user.id;
    const connectionId = req.params.id;
    
    // 检查连接是否存在并属于当前用户
    const existingConnection = db.prepare(
      'SELECT id FROM connections WHERE id = ? AND user_id = ?'
    ).get(connectionId, userId);
    
    if (!existingConnection) {
      return res.status(404).json({
        success: false,
        message: '未找到指定连接或无权限删除'
      });
    }
    
    // 删除连接
    db.prepare(
      'DELETE FROM connections WHERE id = ? AND user_id = ?'
    ).run(connectionId, userId);
    
    // 同时从收藏和历史记录中删除
    db.prepare(
      'DELETE FROM connection_favorites WHERE connection_id = ? AND user_id = ?'
    ).run(connectionId, userId);
    
    db.prepare(
      'DELETE FROM connection_history WHERE connection_id = ? AND user_id = ?'
    ).run(connectionId, userId);
    
    db.prepare(
      'DELETE FROM connection_pinned WHERE connection_id = ? AND user_id = ?'
    ).run(connectionId, userId);
    
    res.json({
      success: true,
      message: '连接删除成功'
    });
  } catch (error) {
    logger.error('删除连接失败', error);
    res.status(500).json({
      success: false,
      message: '删除连接失败',
      error: error.message
    });
  }
};

/**
 * 获取收藏连接
 */
const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 获取收藏连接ID列表
    const favorites = db.prepare(
      'SELECT connection_id FROM connection_favorites WHERE user_id = ?'
    ).all(userId);
    
    const favoriteIds = favorites.map(fav => fav.connection_id);
    
    res.json({
      success: true,
      favorites: favoriteIds
    });
  } catch (error) {
    logger.error('获取收藏连接失败', error);
    res.status(500).json({
      success: false,
      message: '获取收藏连接失败',
      error: error.message
    });
  }
};

/**
 * 更新收藏连接
 */
const updateFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const { favorites } = req.body;
    
    if (!Array.isArray(favorites)) {
      return res.status(400).json({
        success: false,
        message: '收藏数据格式不正确，应为数组'
      });
    }
    
    // 开始事务
    db.prepare('BEGIN TRANSACTION').run();
    
    try {
      // 清除现有收藏
      db.prepare(
        'DELETE FROM connection_favorites WHERE user_id = ?'
      ).run(userId);
      
      // 添加新收藏
      const insertStmt = db.prepare(
        'INSERT INTO connection_favorites (user_id, connection_id) VALUES (?, ?)'
      );
      
      for (const connectionId of favorites) {
        insertStmt.run(userId, connectionId);
      }
      
      // 提交事务
      db.prepare('COMMIT').run();
      
      res.json({
        success: true,
        message: '收藏连接已更新'
      });
    } catch (error) {
      // 回滚事务
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    logger.error('更新收藏连接失败', error);
    res.status(500).json({
      success: false,
      message: '更新收藏连接失败',
      error: error.message
    });
  }
};

/**
 * 获取历史记录
 */
const getHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    // 直接从历史记录表获取所有信息，不依赖connections表
    const history = db.prepare(
      `SELECT connection_id, name, host, port, username, description, group_name, auth_type, timestamp
       FROM connection_history
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT 20`
    ).all(userId);

    const formattedHistory = history.map(item => ({
      id: item.connection_id,
      name: item.name,
      host: item.host,
      port: item.port,
      username: item.username,
      description: item.description || '',
      group: item.group_name || '默认分组',
      authType: item.auth_type || 'password',
      timestamp: item.timestamp
    }));

    res.json({
      success: true,
      history: formattedHistory
    });
  } catch (error) {
    logger.error('获取历史记录失败', error);
    res.status(500).json({
      success: false,
      message: '获取历史记录失败',
      error: error.message
    });
  }
};

/**
 * 添加到历史记录
 */
const addToHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const history = req.body.history;

    // 验证历史记录数据
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({
        success: false,
        message: '连接数据不正确'
      });
    }

    // 获取第一个历史记录
    const connection = history[0];

    if (!connection || !connection.id || !connection.host || !connection.username) {
      return res.status(400).json({
        success: false,
        message: '连接数据不完整'
      });
    }

    // 开始事务
    db.prepare('BEGIN TRANSACTION').run();

    try {
      // 存储完整的连接信息到历史记录
      const timestamp = connection.timestamp || Date.now();
      const name = connection.name || `${connection.username}@${connection.host}`;
      const description = connection.description || '';
      const groupName = connection.group || '默认分组';
      const authType = connection.authType || 'password';
      const port = connection.port || 22;

      // 检查是否已存在相同的历史记录
      const existingHistory = db.prepare(
        'SELECT id FROM connection_history WHERE user_id = ? AND connection_id = ?'
      ).get(userId, connection.id);

      if (existingHistory) {
        // 更新现有历史记录的时间戳
        db.prepare(
          `UPDATE connection_history SET
           name = ?, host = ?, port = ?, username = ?, description = ?,
           group_name = ?, auth_type = ?, timestamp = ?
           WHERE user_id = ? AND connection_id = ?`
        ).run(name, connection.host, port, connection.username, description,
               groupName, authType, timestamp, userId, connection.id);
      } else {
        // 添加新的历史记录
        db.prepare(
          `INSERT INTO connection_history
           (user_id, connection_id, name, host, port, username, description, group_name, auth_type, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(userId, connection.id, name, connection.host, port, connection.username,
               description, groupName, authType, timestamp);
      }

      // 限制历史记录数量为20条
      db.prepare(
        `DELETE FROM connection_history
         WHERE user_id = ? AND id NOT IN (
           SELECT id FROM connection_history
           WHERE user_id = ?
           ORDER BY timestamp DESC
           LIMIT 20
         )`
      ).run(userId, userId);

      // 提交事务
      db.prepare('COMMIT').run();

      res.json({
        success: true,
        message: '已添加到历史记录'
      });
    } catch (error) {
      // 回滚事务
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    logger.error('添加历史记录失败', error);
    res.status(500).json({
      success: false,
      message: '添加到历史记录失败',
      error: error.message
    });
  }
};

/**
 * 从历史记录中删除
 */
const removeFromHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const connectionId = req.params.id;
    
    // 从历史记录中删除
    db.prepare(
      'DELETE FROM connection_history WHERE connection_id = ? AND user_id = ?'
    ).run(connectionId, userId);
    
    res.json({
      success: true,
      message: '已从历史记录中删除'
    });
  } catch (error) {
    logger.error('删除历史记录失败', error);
    res.status(500).json({
      success: false,
      message: '从历史记录中删除失败',
      error: error.message
    });
  }
};

/**
 * 获取置顶连接
 */
const getPinned = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 获取置顶连接
    const pinned = db.prepare(
      'SELECT connection_id FROM connection_pinned WHERE user_id = ?'
    ).all(userId);
    
    // 转换为对象格式
    const pinnedObj = {};
    pinned.forEach(pin => {
      pinnedObj[pin.connection_id] = true;
    });
    
    res.json({
      success: true,
      pinned: pinnedObj
    });
  } catch (error) {
    logger.error('获取置顶连接失败', error);
    res.status(500).json({
      success: false,
      message: '获取置顶连接失败',
      error: error.message
    });
  }
};

/**
 * 更新置顶连接
 */
const updatePinned = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pinned } = req.body;
    
    if (typeof pinned !== 'object') {
      return res.status(400).json({
        success: false,
        message: '置顶数据格式不正确，应为对象'
      });
    }
    
    // 开始事务
    db.prepare('BEGIN TRANSACTION').run();
    
    try {
      // 清除现有置顶
      db.prepare(
        'DELETE FROM connection_pinned WHERE user_id = ?'
      ).run(userId);
      
      // 添加新置顶
      const insertStmt = db.prepare(
        'INSERT INTO connection_pinned (user_id, connection_id) VALUES (?, ?)'
      );
      
      for (const connectionId in pinned) {
        if (pinned[connectionId]) {
          insertStmt.run(userId, connectionId);
        }
      }
      
      // 提交事务
      db.prepare('COMMIT').run();
      
      res.json({
        success: true,
        message: '置顶连接已更新'
      });
    } catch (error) {
      // 回滚事务
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    logger.error('更新置顶连接失败', error);
    res.status(500).json({
      success: false,
      message: '更新置顶连接失败',
      error: error.message
    });
  }
};

/**
 * 批量同步连接数据
 */
const syncConnections = async (req, res) => {
  try {
    const userId = req.user.id;
    const { connections, favorites, history, pinned } = req.body;
    
    // 验证数据格式
    if (!Array.isArray(connections) || !Array.isArray(favorites) || 
        !Array.isArray(history) || typeof pinned !== 'object') {
      return res.status(400).json({
        success: false,
        message: '数据格式不正确'
      });
    }
    
    // 开始事务
    db.prepare('BEGIN TRANSACTION').run();
    
    try {
      // 同步连接
      // 首先获取现有连接ID
      const existingConnections = db.prepare(
        'SELECT id FROM connections WHERE user_id = ?'
      ).all(userId);
      
      const existingIds = new Set(existingConnections.map(conn => conn.id));
      const now = new Date().toISOString();
      
      // 准备语句
      const updateStmt = db.prepare(
        `UPDATE connections SET
          name = ?,
          host = ?,
          port = ?,
          username = ?,
          password = ?,
          remember_password = ?,
          private_key = ?,
          passphrase = ?,
          auth_type = ?,
          description = ?,
          group_name = ?,
          config = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ?`
      );
      
      const insertStmt = db.prepare(
        `INSERT INTO connections (
          id, user_id, name, host, port, username, password, 
          remember_password, private_key, passphrase, auth_type, 
          description, group_name, config, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      
      // 更新或新增连接
      for (const connection of connections) {
        // 加密敏感数据
        const encryptedConnection = processConnectionSensitiveData(connection, true);

        if (existingIds.has(connection.id)) {
          // 更新现有连接
          updateStmt.run(
            encryptedConnection.name || `${encryptedConnection.username}@${encryptedConnection.host}`,
            encryptedConnection.host,
            encryptedConnection.port || 22,
            encryptedConnection.username,
            encryptedConnection.rememberPassword ? encryptedConnection.password : '',
            encryptedConnection.rememberPassword ? 1 : 0,
            encryptedConnection.privateKey || '',
            encryptedConnection.passphrase || '',
            encryptedConnection.authType || 'password',
            encryptedConnection.description || '',
            encryptedConnection.group || '默认分组',
            JSON.stringify(encryptedConnection.config || {}),
            now,
            connection.id,
            userId
          );
        } else {
          // 添加新连接
          insertStmt.run(
            connection.id,
            userId,
            encryptedConnection.name || `${encryptedConnection.username}@${encryptedConnection.host}`,
            encryptedConnection.host,
            encryptedConnection.port || 22,
            encryptedConnection.username,
            encryptedConnection.rememberPassword ? encryptedConnection.password : '',
            encryptedConnection.rememberPassword ? 1 : 0,
            encryptedConnection.privateKey || '',
            encryptedConnection.passphrase || '',
            encryptedConnection.authType || 'password',
            encryptedConnection.description || '',
            encryptedConnection.group || '默认分组',
            JSON.stringify(encryptedConnection.config || {}),
            now,
            now
          );
        }
      }
      
      // 同步收藏
      db.prepare('DELETE FROM connection_favorites WHERE user_id = ?').run(userId);
      
      const insertFavoriteStmt = db.prepare(
        'INSERT INTO connection_favorites (user_id, connection_id) VALUES (?, ?)'
      );
      
      for (const connectionId of favorites) {
        insertFavoriteStmt.run(userId, connectionId);
      }
      
      // 同步历史记录
      db.prepare('DELETE FROM connection_history WHERE user_id = ?').run(userId);

      const insertHistoryStmt = db.prepare(
        `INSERT INTO connection_history
         (user_id, connection_id, name, host, port, username, description, group_name, auth_type, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const historyItem of history) {
        // 从connections数组中查找对应的连接信息
        const connectionInfo = connections.find(conn => conn.id === historyItem.id);
        if (connectionInfo) {
          const name = connectionInfo.name || `${connectionInfo.username}@${connectionInfo.host}`;
          const description = connectionInfo.description || '';
          const groupName = connectionInfo.group || '默认分组';
          const authType = connectionInfo.authType || 'password';
          const port = connectionInfo.port || 22;

          insertHistoryStmt.run(
            userId,
            historyItem.id,
            name,
            connectionInfo.host,
            port,
            connectionInfo.username,
            description,
            groupName,
            authType,
            historyItem.timestamp
          );
        }
      }
      
      // 同步置顶
      db.prepare('DELETE FROM connection_pinned WHERE user_id = ?').run(userId);
      
      const insertPinnedStmt = db.prepare(
        'INSERT INTO connection_pinned (user_id, connection_id) VALUES (?, ?)'
      );
      
      for (const connectionId in pinned) {
        if (pinned[connectionId]) {
          insertPinnedStmt.run(userId, connectionId);
        }
      }
      
      // 提交事务
      db.prepare('COMMIT').run();
      
      res.json({
        success: true,
        message: '连接数据同步成功'
      });
    } catch (error) {
      // 回滚事务
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    logger.error('同步连接数据失败', error);
    res.status(500).json({
      success: false,
      message: '同步连接数据失败',
      error: error.message
    });
  }
};

module.exports = {
  getUserConnections,
  addConnection,
  updateConnection,
  deleteConnection,
  getFavorites,
  updateFavorites,
  getHistory,
  addToHistory,
  removeFromHistory,
  getPinned,
  updatePinned,
  syncConnections
}; 