// @ts-nocheck
/**
 * 连接控制器
 * 处理连接相关的API请求
 */

const logger = require('../utils/logger');
const db = require('../config/database').getDb();
const { validateConnection } = require('../utils/validators');
const { processConnectionSensitiveData, decryptPassword, decryptPrivateKey } = require('../utils/encryption');

const getNextSortOrderForUser = userId => {
  try {
    const result = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM connections WHERE user_id = ?')
      .get(userId);
    return result?.nextOrder || 1;
  } catch (error) {
    logger.warn('计算下一个连接排序值失败，使用默认值1', error);
    return 1;
  }
};

/**
 * 获取用户的所有连接
 */
const getUserConnections = async (req, res) => {
  try {
    const userId = req.user.id;

    // 从数据库获取用户连接
    const connections = db.prepare(
      'SELECT * FROM connections WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC'
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
          sortOrder: typeof decryptedConn.sort_order === 'number' ? decryptedConn.sort_order : 0,
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
    const sortOrder =
      typeof connection.sortOrder === 'number' ? connection.sortOrder : getNextSortOrderForUser(userId);

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
        description, group_name, config, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        sortOrder,
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
      'SELECT id, sort_order FROM connections WHERE id = ? AND user_id = ?'
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
    const sortOrder =
      typeof connection.sortOrder === 'number'
        ? connection.sortOrder
        : typeof existingConnection.sort_order === 'number'
          ? existingConnection.sort_order
          : getNextSortOrderForUser(userId);

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
        sort_order = ?,
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
      sortOrder,
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
      `SELECT id AS entry_id, connection_id, name, host, port, username, description, group_name, auth_type, timestamp
       FROM connection_history
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT 20`
    ).all(userId);

    const formattedHistory = history.map(item => ({
      entryId: item.entry_id,
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
      // 存储完整的连接信息到历史记录（无条件新增一条记录）
      const timestamp = connection.timestamp || Date.now();
      const name = connection.name || `${connection.username}@${connection.host}`;
      const description = connection.description || '';
      const groupName = connection.group || '默认分组';
      const authType = connection.authType || 'password';
      const port = connection.port || 22;

      // 无条件插入历史记录
      const insertInfo = db.prepare(
        `INSERT INTO connection_history
         (user_id, connection_id, name, host, port, username, description, group_name, auth_type, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        connection.id,
        name,
        connection.host,
        port,
        connection.username,
        description,
        groupName,
        authType,
        timestamp
      );

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

      const entryId =
        insertInfo && typeof insertInfo.lastInsertRowid !== 'undefined'
          ? Number(insertInfo.lastInsertRowid)
          : null;

      res.json({
        success: true,
        message: '已添加到历史记录',
        entryId
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
 * 按单条记录删除历史（根据自增ID）
 */
const removeHistoryEntry = async (req, res) => {
  try {
    const userId = req.user.id;
    const entryId = parseInt(req.params.entryId, 10);

    if (!Number.isInteger(entryId) || entryId <= 0) {
      return res.status(400).json({ success: false, message: '无效的历史记录ID' });
    }

    const result = db
      .prepare('DELETE FROM connection_history WHERE id = ? AND user_id = ?')
      .run(entryId, userId);

    res.json({
      success: true,
      message: '已删除历史记录',
      deleted: result.changes || 0
    });
  } catch (error) {
    logger.error('按条删除历史记录失败', error);
    res.status(500).json({
      success: false,
      message: '按条删除历史记录失败',
      error: error.message
    });
  }
};

/**
 * 清空当前用户的所有历史记录
 */
const clearHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = db
      .prepare('DELETE FROM connection_history WHERE user_id = ?')
      .run(userId);

    res.json({
      success: true,
      message: '历史记录已清空',
      deleted: result.changes || 0
    });
  } catch (error) {
    logger.error('清空历史记录失败', error);
    res.status(500).json({
      success: false,
      message: '清空历史记录失败',
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

    // 获取置顶连接（含时间戳）
    const pinned = db.prepare(
      'SELECT connection_id, pinned_at FROM connection_pinned WHERE user_id = ?'
    ).all(userId);

    // 转换为对象格式：id -> 时间戳（统一返回数值，无兼容逻辑）
    const pinnedObj = {};
    pinned.forEach(pin => {
      pinnedObj[pin.connection_id] = pin.pinned_at;
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
 * 汇总获取 connections/favorites/history/pinned（减少首屏往返）
 */
const getOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1) 连接列表（与 getUserConnections 一致的字段与解密逻辑）
    const rows = db.prepare(
      'SELECT * FROM connections WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).all(userId);

    const connections = rows
      .map(conn => {
        try {
          if (conn.config) {
            conn.config = JSON.parse(conn.config);
          }
          const decrypted = { ...conn };
          if (decrypted.password && decrypted.remember_password) {
            decrypted.password = decryptPassword(decrypted.password);
          }
          if (decrypted.privateKey) {
            decrypted.privateKey = decryptPrivateKey(decrypted.privateKey);
          }
          if (decrypted.passphrase) {
            decrypted.passphrase = decryptPassword(decrypted.passphrase);
          }
          return {
            id: decrypted.id,
            name: decrypted.name,
            host: decrypted.host,
            port: decrypted.port,
            username: decrypted.username,
            password: decrypted.remember_password ? decrypted.password : '',
            rememberPassword: !!decrypted.remember_password,
            privateKey: decrypted.privateKey || '',
            passphrase: decrypted.passphrase || '',
            authType: decrypted.auth_type || 'password',
          description: decrypted.description || '',
          group: decrypted.group_name || '默认分组',
          config: decrypted.config || {},
          sortOrder: typeof decrypted.sort_order === 'number' ? decrypted.sort_order : 0,
          createdAt: decrypted.created_at,
          updatedAt: decrypted.updated_at
        };
        } catch (e) {
          logger.error(`处理连接数据错误：${e.message}`, { connectionId: conn.id });
          return null;
        }
      })
      .filter(Boolean);

    // 2) 收藏（ID数组）
    const favRows = db
      .prepare('SELECT connection_id FROM connection_favorites WHERE user_id = ?')
      .all(userId);
    const favorites = favRows.map(r => r.connection_id);

    // 3) 历史记录（最近20条）
    const histRows = db
      .prepare(
        `SELECT id AS entry_id, connection_id, name, host, port, username, description, group_name, auth_type, timestamp
         FROM connection_history
         WHERE user_id = ?
         ORDER BY timestamp DESC
         LIMIT 20`
      )
      .all(userId);
    const history = histRows.map(item => ({
      entryId: item.entry_id,
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

    // 4) 置顶（对象映射）
    const pinRows = db
      .prepare('SELECT connection_id, pinned_at FROM connection_pinned WHERE user_id = ?')
      .all(userId);
    const pinned = {};
    pinRows.forEach(pin => {
      pinned[pin.connection_id] = pin.pinned_at;
    });

    return res.json({ success: true, connections, favorites, history, pinned });
  } catch (error) {
    logger.error('获取连接汇总数据失败', error);
    return res.status(500).json({ success: false, message: '获取连接汇总数据失败', error: error.message });
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

      // 添加新置顶（带时间戳）
      const insertStmt = db.prepare(
        'INSERT INTO connection_pinned (user_id, connection_id, pinned_at) VALUES (?, ?, ?)'
      );

      for (const connectionId in pinned) {
        if (pinned[connectionId]) {
          const pinnedAt = typeof pinned[connectionId] === 'number' ? pinned[connectionId] : Date.now();
          insertStmt.run(userId, connectionId, pinnedAt);
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
 * 更新连接排序
 */
const updateConnectionOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { order } = req.body;

    if (!Array.isArray(order)) {
      return res.status(400).json({
        success: false,
        message: '排序数据格式不正确，应为数组'
      });
    }

    const updateStmt = db.prepare(
      'UPDATE connections SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    );
    const now = new Date().toISOString();

    db.prepare('BEGIN TRANSACTION').run();
    try {
      order.forEach((item, index) => {
        const id = typeof item === 'string' ? item : item?.id;
        if (!id) return;
        const sortOrder =
          typeof item?.sortOrder === 'number' ? item.sortOrder : index + 1;
        updateStmt.run(sortOrder, now, id, userId);
      });
      db.prepare('COMMIT').run();
      return res.json({ success: true });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    logger.error('更新连接排序失败', error);
    return res.status(500).json({
      success: false,
      message: '更新连接排序失败',
      error: error.message
    });
  }
};

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
          sort_order = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ?`
      );

      const insertStmt = db.prepare(
        `INSERT INTO connections (
          id, user_id, name, host, port, username, password, 
          remember_password, private_key, passphrase, auth_type, 
          description, group_name, config, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // 更新或新增连接
      for (let index = 0; index < connections.length; index += 1) {
        const connection = connections[index];
        // 加密敏感数据
        const encryptedConnection = processConnectionSensitiveData(connection, true);
        const sortOrder =
          typeof connection.sortOrder === 'number' ? connection.sortOrder : index + 1;

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
            sortOrder,
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
            sortOrder,
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

      // 同步置顶（带时间戳）
      db.prepare('DELETE FROM connection_pinned WHERE user_id = ?').run(userId);

      const insertPinnedStmt = db.prepare(
        'INSERT INTO connection_pinned (user_id, connection_id, pinned_at) VALUES (?, ?, ?)'
      );

      for (const connectionId in pinned) {
        if (pinned[connectionId]) {
          const pinnedAt = typeof pinned[connectionId] === 'number' ? pinned[connectionId] : Date.now();
          insertPinnedStmt.run(userId, connectionId, pinnedAt);
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
  removeHistoryEntry,
  clearHistory,
  getPinned,
  getOverview,
  updatePinned,
  updateConnectionOrder,
  syncConnections
};
