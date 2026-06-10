const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('front'));

// Configuración del pool de conexiones
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'desde_casa',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==================== FUNCIÓN AUXILIAR PARA PYTHON ====================
function ejecutarPython(datos) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn(process.platform === 'win32' ? 'python' : 'python3', ['analitica.py']);
        let salida = '';
        let errorSalida = '';

        pythonProcess.stdout.on('data', (data) => {
            salida += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorSalida += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python error: ${errorSalida}`));
                return;
            }
            try {
                const resultado = JSON.parse(salida);
                if (resultado.error_python) {
                    reject(new Error(resultado.mensaje));
                } else {
                    resolve(resultado);
                }
            } catch (e) {
                reject(new Error(`Error al parsear JSON de Python: ${e.message}`));
            }
        });

        pythonProcess.stdin.write(JSON.stringify(datos));
        pythonProcess.stdin.end();
    });
}

// ==================== REGISTRO DE EMPRESA ====================
app.post('/api/empresa/registro', async (req, res) => {
    console.log("📥 Registro de empresa - Datos recibidos:", req.body);
    
    const { nombre, direccion, telefono, tipo, tarifa_envio, email, contrasena } = req.body;
    let conexion;
    
    try {
        if (!nombre || !direccion || !telefono || !email || !contrasena) {
            return res.status(400).json({ error: "Todos los campos son obligatorios" });
        }
        
        conexion = await pool.getConnection();
        await conexion.beginTransaction();
        
        const [existeUsuario] = await conexion.execute('SELECT id_usuario FROM USUARIO WHERE email = ?', [email]);
        
        if (existeUsuario.length > 0) {
            await conexion.rollback();
            return res.status(400).json({ error: "Este correo ya está registrado" });
        }
        
        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);
        
        const [resultadoUsuario] = await conexion.execute(
            `INSERT INTO USUARIO (nombre, email, contraseña, rol, telefono, metodo_pago) 
             VALUES (?, ?, ?, 'Empresa', ?, 'Efectivo')`,
            [nombre, email, contrasenaEncriptada, telefono]
        );
        
        const id_usuario = resultadoUsuario.insertId;
        console.log(`✅ Usuario creado con ID: ${id_usuario}`);
        
        const [resultadoEmpresa] = await conexion.execute(
            `INSERT INTO EMPRESA (nombre, direccion, telefono, tipo, tarifa_envio, id_usuario) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nombre, direccion, telefono, tipo, parseFloat(tarifa_envio) || 0, id_usuario]
        );
        
        console.log(`✅ Empresa creada con ID: ${resultadoEmpresa.insertId}`);
        
        await conexion.commit();
        
        return res.status(201).json({ 
            mensaje: "Empresa registrada con éxito", 
            id_empresa: resultadoEmpresa.insertId,
            id_usuario: id_usuario
        });
        
    } catch (error) {
        if (conexion) await conexion.rollback();
        console.error("❌ ERROR EN REGISTRO DE EMPRESA:", error.message);
        return res.status(500).json({ error: "Error interno del servidor: " + error.message });
        
    } finally {
        if (conexion) conexion.release();
    }
});

// ==================== ACTUALIZAR PRODUCTO ====================
app.put('/api/productos/:id', async (req, res) => {
    try {
        const id_producto = req.params.id;
        const { nombre, precio, stock } = req.body;
        
        let query = 'UPDATE PRODUCTO SET ';
        const updates = [];
        const valores = [];
        
        if (nombre !== undefined) {
            updates.push('nombre = ?');
            valores.push(nombre);
        }
        if (precio !== undefined) {
            updates.push('precio = ?');
            valores.push(parseFloat(precio));
        }
        if (stock !== undefined) {
            updates.push('stock = ?');
            valores.push(parseInt(stock));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: "No hay datos para actualizar" });
        }
        
        query += updates.join(', ') + ' WHERE id_producto = ?';
        valores.push(id_producto);
        
        const [resultado] = await pool.execute(query, valores);
        
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }
        
        res.json({ mensaje: "Producto actualizado correctamente" });
        
    } catch (error) {
        console.error("❌ Error al actualizar:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ELIMINAR PRODUCTO ====================
app.delete('/api/productos/:id', async (req, res) => {
    try {
        const id_producto = req.params.id;
        const [resultado] = await pool.execute('DELETE FROM PRODUCTO WHERE id_producto = ?', [id_producto]);
        
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }
        
        res.json({ mensaje: "Producto eliminado correctamente" });
        
    } catch (error) {
        console.error("❌ Error al eliminar:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==================== LOGIN ====================
app.post('/api/auth/login', async (req, res) => {
    const { email, contrasena } = req.body;
    console.log(`🔐 Intento de login: ${email}`);
    
    try {
        const [usuarios] = await pool.execute(
            'SELECT id_usuario AS id, nombre, rol, contraseña FROM USUARIO WHERE email = ? AND rol = "Cliente"', 
            [email]
        );
        
        if (usuarios.length > 0) {
            if (await bcrypt.compare(contrasena, usuarios[0].contraseña)) {
                return res.status(200).json({
                    mensaje: "Login exitoso",
                    rol: "Cliente",
                    id: usuarios[0].id,
                    nombre: usuarios[0].nombre
                });
            }
        }
        
        const [empresasUsuarios] = await pool.execute(
            `SELECT u.id_usuario AS id, u.nombre, u.contraseña, e.id_empresa 
             FROM USUARIO u
             INNER JOIN EMPRESA e ON u.id_usuario = e.id_usuario
             WHERE u.email = ? AND u.rol = 'Empresa'`,
            [email]
        );
        
        if (empresasUsuarios.length > 0) {
            if (await bcrypt.compare(contrasena, empresasUsuarios[0].contraseña)) {
                return res.status(200).json({
                    mensaje: "Login exitoso",
                    rol: "Empresa",
                    id_usuario: empresasUsuarios[0].id,
                    id_empresa: empresasUsuarios[0].id_empresa,
                    nombre: empresasUsuarios[0].nombre
                });
            }
        }
        
        const [domiciliarios] = await pool.execute(
            'SELECT id_domiciliario AS id, nombre, contraseña FROM DOMICILIARIO WHERE email = ?', 
            [email]
        );
        
        if (domiciliarios.length > 0) {
            if (await bcrypt.compare(contrasena, domiciliarios[0].contraseña)) {
                return res.status(200).json({
                    mensaje: "Login exitoso",
                    rol: "Domiciliario",
                    id: domiciliarios[0].id,
                    nombre: domiciliarios[0].nombre
                });
            }
        }
        
        return res.status(401).json({ error: "Credenciales incorrectas" });
        
    } catch (error) {
        console.error("❌ ERROR EN LOGIN:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ==================== REGISTRO DE USUARIO CLIENTE ====================
app.post('/api/usuarios', async (req, res) => {
    try {
        const { nombre, telefono, email, contrasena, metodo_pago, direccion, rol } = req.body;
        if (!contrasena) return res.status(400).json({ error: "La contraseña es obligatoria" });

        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);
        const query = `INSERT INTO usuario (nombre, telefono, email, contraseña, metodo_pago, direccion, rol) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const [resultado] = await pool.execute(query, [nombre, telefono, email, contrasenaEncriptada, metodo_pago, direccion || 'Dirección no registrada', rol || 'Cliente']);

        return res.status(201).json({ mensaje: 'Usuario registrado con éxito', id_usuario: resultado.insertId });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return res.status(400).json({ error: error.message });
    }
});

// ==================== OBTENER DATOS DE USUARIO ====================
app.get('/api/usuarios/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`📋 Consultando usuario ID: ${id}`);
    
    try {
        const idNumerico = parseInt(id);
        if (isNaN(idNumerico)) {
            return res.status(400).json({ error: "ID inválido" });
        }
        
        const [rows] = await pool.execute(
            `SELECT id_usuario, nombre, email, telefono, metodo_pago, rol 
             FROM USUARIO 
             WHERE id_usuario = ?`,
            [idNumerico]
        );
        
        if (rows.length === 0) {
            console.log(`❌ Usuario ${id} no encontrado`);
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        
        console.log(`✅ Usuario encontrado: ${rows[0].nombre}`);
        res.json(rows[0]);
        
    } catch (error) {
        console.error("❌ Error en /api/usuarios/:id:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==================== RECOMENDACIONES PERSONALIZADAS ====================
app.get('/api/recomendaciones/:id_usuario', async (req, res) => {
    const idUsuario = req.params.id_usuario;
    
    try {
        const [ultimoPedido] = await pool.execute(`
            SELECT p.id_empresa, e.tipo, e.nombre as empresa_nombre
            FROM PEDIDO p
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
            WHERE p.id_usuario = ? AND p.estado = 'Entregado'
            ORDER BY p.id_pedido DESC
            LIMIT 1
        `, [idUsuario]);
        
        let recomendacion = "";
        
        if (ultimoPedido.length > 0) {
            const empresa = ultimoPedido[0];
            
            if (empresa.tipo === 'Restaurante') {
                recomendacion = `🍕 ¡Sigue antojado! Prueba otros productos de ${empresa.empresa_nombre} o explora más restaurantes en Maicao.`;
            } else if (empresa.tipo === 'Farmacia') {
                recomendacion = `💊 Cuida tu salud. Revisa nuestras promociones en medicamentos y productos de bienestar.`;
            } else {
                recomendacion = `🛒 ¡Vuelve pronto! ${empresa.empresa_nombre} tiene nuevos productos que te pueden interesar.`;
            }
        } else {
            const [populares] = await pool.execute(`
                SELECT p.nombre, COUNT(dp.id_producto) as total
                FROM DETALLE_PEDIDO dp
                INNER JOIN PRODUCTO p ON dp.id_producto = p.id_producto
                GROUP BY p.id_producto
                ORDER BY total DESC
                LIMIT 1
            `);
            
            if (populares.length > 0) {
                recomendacion = `🔥 Lo más pedido en Maicao: ¡${populares[0].nombre}! Agrégalo a tu carrito.`;
            } else {
                recomendacion = `🌟 ¡Bienvenido a DomiClick! Explora nuestro catálogo y encuentra lo que necesitas.`;
            }
        }
        
        res.json({ recomendacion });
        
    } catch (error) {
        res.json({ recomendacion: "🌟 ¡Descubre nuestros productos destacados!" });
    }
});

// ==================== ENDPOINTS DE PRODUCTOS ====================
app.get('/api/productos/catalogo-cliente', async (req, res) => {
    try {
        const { buscar, id_empresa } = req.query;
        let query = `
            SELECT p.id_producto, p.nombre, p.precio, p.stock, p.id_empresa, e.nombre AS nombre_empresa 
            FROM PRODUCTO p
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
        `;
        let parametros = [];
        let condiciones = [];

        if (id_empresa) {
            condiciones.push('p.id_empresa = ?');
            parametros.push(id_empresa);
        }

        if (buscar && buscar.trim() !== "") {
            condiciones.push('(p.nombre LIKE ? OR e.nombre LIKE ?)');
            parametros.push(`%${buscar}%`, `%${buscar}%`);
        }

        if (condiciones.length > 0) {
            query += ' WHERE ' + condiciones.join(' AND ');
        }

        const [productos] = await pool.execute(query, parametros);
        return res.status(200).json(productos);
    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ error: "Error interno al procesar el catálogo" });
    }
});

app.get('/api/empresas/:id/productos', async (req, res) => {
    try {
        const idEmpresa = req.params.id;
        const { buscar } = req.query;

        let query = 'SELECT id_producto, nombre, precio, stock FROM PRODUCTO WHERE id_empresa = ?';
        let parametros = [idEmpresa];

        if (buscar && buscar.trim() !== "") {
            query += ' AND nombre LIKE ?';
            parametros.push(`%${buscar}%`);
        }

        const [productos] = await pool.execute(query, parametros);
        return res.status(200).json(productos);
    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/api/productos', async (req, res) => {
    try {
        const { id_empresa, nombre, precio, stock } = req.body;
        if (!id_empresa || !nombre || !precio || stock === undefined) {
            return res.status(400).json({ error: "Todos los campos son obligatorios" });
        }

        const query = `INSERT INTO PRODUCTO (id_empresa, nombre, precio, stock) VALUES (?, ?, ?, ?)`;
        const [resultado] = await pool.execute(query, [parseInt(id_empresa), nombre, parseFloat(precio), parseInt(stock)]);

        return res.status(201).json({ mensaje: "Producto registrado exitosamente", id_producto: resultado.insertId });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ==================== PEDIDOS PENDIENTES CON PRODUCTOS ====================
app.get('/api/pedidos/pendientes', async (req, res) => {
    console.log("📋 [PENDIENTES] Consultando pedidos pendientes con productos...");
    try {
        const [pedidos] = await pool.execute(`
            SELECT 
                p.id_pedido, 
                p.total, 
                e.nombre as empresa_nombre,
                COALESCE(u.direccion, 'Dirección no registrada') as direccion_entrega,
                GROUP_CONCAT(pr.nombre SEPARATOR ', ') as productos_nombres
            FROM PEDIDO p
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
            LEFT JOIN USUARIO u ON p.id_usuario = u.id_usuario
            LEFT JOIN DETALLE_PEDIDO dp ON p.id_pedido = dp.id_pedido
            LEFT JOIN PRODUCTO pr ON dp.id_producto = pr.id_producto
            WHERE p.estado = 'Pendiente' AND (p.id_domiciliario IS NULL OR p.id_domiciliario = 0)
            GROUP BY p.id_pedido, p.total, e.nombre, u.direccion
            ORDER BY p.id_pedido ASC
        `);
        
        // Formatear para que muestre el primer producto o "Varios productos"
        const pedidosFormateados = pedidos.map(p => ({
            id_pedido: p.id_pedido,
            total: p.total,
            empresa_nombre: p.empresa_nombre,
            direccion_entrega: p.direccion_entrega,
            producto_principal: p.productos_nombres ? p.productos_nombres.split(',')[0] : 'Producto',
            tiene_varios: p.productos_nombres && p.productos_nombres.includes(',')
        }));
        
        console.log(`✅ ${pedidosFormateados.length} pedidos pendientes encontrados`);
        res.json(pedidosFormateados);
        
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/pedidos', async (req, res) => {
    try {
        const [pedidos] = await pool.execute(`
            SELECT p.id_pedido, p.total, p.estado, p.fecha, u.nombre as cliente_nombre, e.nombre as empresa_nombre
            FROM PEDIDO p
            INNER JOIN USUARIO u ON p.id_usuario = u.id_usuario
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
            ORDER BY p.id_pedido DESC
        `);
        res.json(pedidos);
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// SEGUNDO: rutas con parámetros específicos
app.get('/api/pedidos/usuario/:id', async (req, res) => {
    try {
        const idUsuario = req.params.id;
        const query = `
            SELECT id_pedido, total, estado, fecha 
            FROM PEDIDO 
            WHERE id_usuario = ? 
            ORDER BY id_pedido DESC
        `;
        const [pedidos] = await pool.execute(query, [idUsuario]);
        return res.status(200).json(pedidos);
    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ error: "Error al obtener el historial" });
    }
});

app.get('/api/pedidos/empresa/:id', async (req, res) => {
    const idEmpresa = req.params.id;
    console.log(`📥 Consultando pedidos para empresa ID: ${idEmpresa}`);

    try {
        const [rows] = await pool.execute(
            'SELECT id_pedido, total, estado, metodo_pago, fecha FROM PEDIDO WHERE id_empresa = ? ORDER BY id_pedido DESC',
            [idEmpresa]
        );
        return res.status(200).json(rows);
    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

// TERCERO: rutas con parámetro :id (esta debe ir DESPUÉS de las específicas)
app.get('/api/pedidos/:id', async (req, res) => {
    try {
        const idPedido = req.params.id;
        
        // Evitar que "pendientes" sea interpretado como ID
        if (idPedido === 'pendientes' || idPedido === 'usuario' || idPedido === 'empresa') {
            return res.status(404).json({ error: "Ruta no válida" });
        }
        
        const [rows] = await pool.execute('SELECT id_pedido, estado, total FROM PEDIDO WHERE id_pedido = ?', [idPedido]);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Pedido no encontrado" });
        }

        return res.status(200).json(rows[0]);
    } catch (error) {
        console.error("❌ Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/pedidos', async (req, res) => {
    const { id_usuario, id_empresa, metodo_pago, productos } = req.body;
    let conexion;
    try {
        conexion = await pool.getConnection();
        await conexion.beginTransaction();

        for (const item of productos) {
            const [stockActual] = await conexion.execute('SELECT stock FROM PRODUCTO WHERE id_producto = ?', [item.id_producto]);
            if (stockActual.length === 0) throw new Error(`Producto ${item.id_producto} no existe`);
            if (stockActual[0].stock < item.cantidad) throw new Error(`Stock insuficiente para producto ID ${item.id_producto}`);
        }

        const [empresa] = await conexion.execute('SELECT tarifa_envio FROM EMPRESA WHERE id_empresa = ?', [id_empresa]);
        if (empresa.length === 0) throw new Error('La empresa no existe');
        const tarifaEnvio = parseFloat(empresa[0].tarifa_envio);

        const queryPedido = `INSERT INTO PEDIDO (id_usuario, id_empresa, metodo_pago, total, estado, fecha) VALUES (?, ?, ?, 0.00, 'Pendiente', NOW())`;
        const [pedidoResultado] = await conexion.execute(queryPedido, [id_usuario, id_empresa, metodo_pago]);
        const id_pedido = pedidoResultado.insertId;

        let totalProductos = 0;
        for (const item of productos) {
            const queryDetalle = `INSERT INTO DETALLE_PEDIDO (id_pedido, id_producto, cantidad, precio) VALUES (?, ?, ?, ?)`;
            await conexion.execute(queryDetalle, [id_pedido, item.id_producto, item.cantidad, item.precio]);

            totalProductos += item.cantidad * item.precio;
            await conexion.execute('UPDATE PRODUCTO SET stock = stock - ? WHERE id_producto = ?', [item.cantidad, item.id_producto]);
        }

        const totalFinal = totalProductos + tarifaEnvio;
        await conexion.execute('UPDATE PEDIDO SET total = ? WHERE id_pedido = ?', [totalFinal, id_pedido]);

        await conexion.commit();
        res.status(201).json({ mensaje: 'Pedido procesado', id_pedido, total: totalFinal });
    } catch (error) {
        if (conexion) await conexion.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        if (conexion) conexion.release();
    }
});

app.put('/api/pedidos/:id/estado', async (req, res) => {
    const id_pedido = req.params.id;
    const { estado } = req.body;
    
    const estadosValidos = ['Pendiente', 'Preparacion', 'En camino', 'Entregado', 'Cancelado'];
    
    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: "Estado no válido" });
    }
    
    try {
        const [resultado] = await pool.execute(
            'UPDATE PEDIDO SET estado = ? WHERE id_pedido = ?',
            [estado, id_pedido]
        );
        
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: "Pedido no encontrado" });
        }
        
        if (estado === 'Entregado') {
            const [pedido] = await pool.execute('SELECT id_domiciliario FROM PEDIDO WHERE id_pedido = ?', [id_pedido]);
            if (pedido[0]?.id_domiciliario) {
                await pool.execute('UPDATE DOMICILIARIO SET estado = "Disponible" WHERE id_domiciliario = ?', [pedido[0].id_domiciliario]);
            }
        }
        
        res.json({ mensaje: `Estado actualizado a: ${estado}` });
        
    } catch (error) {
        console.error("❌ Error al actualizar estado:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ENDPOINTS PARA EMPRESAS ====================
app.get('/api/empresas/:id/analitica-avanzada', async (req, res) => {
    const id_empresa = req.params.id;
    console.log(`📊 Analítica solicitada para empresa ID: ${id_empresa}`);
    
    try {
        const idNumerico = parseInt(id_empresa);
        if (isNaN(idNumerico)) {
            return res.status(400).json({ error: "ID de empresa inválido" });
        }
        
        const [empresa] = await pool.execute(
            'SELECT id_empresa, nombre, tipo FROM EMPRESA WHERE id_empresa = ?', 
            [idNumerico]
        );
        
        if (!empresa || empresa.length === 0) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }
        
        const [pedidos] = await pool.execute(
            'SELECT estado, total, fecha FROM PEDIDO WHERE id_empresa = ?', 
            [idNumerico]
        );
        
        let detallesProductos = [];
        try {
            [detallesProductos] = await pool.execute(`
                SELECT dp.cantidad, p.nombre, dp.precio 
                FROM DETALLE_PEDIDO dp
                INNER JOIN PRODUCTO p ON dp.id_producto = p.id_producto
                INNER JOIN PEDIDO ped ON dp.id_pedido = ped.id_pedido
                WHERE ped.id_empresa = ?
            `, [idNumerico]);
        } catch (err) {
            console.warn("⚠️ No se pudieron obtener detalles:", err.message);
        }
        
        let completados = 0, procesando = 0, cancelados = 0, ingresos = 0;
        
        for (const p of pedidos) {
            const total = parseFloat(p.total) || 0;
            if (p.estado === 'Entregado') {
                completados++;
                ingresos += total;
            } else if (p.estado === 'Cancelado') {
                cancelados++;
            } else {
                procesando++;
            }
        }
        
        let bestSeller = { nombre: "Sin ventas", precio: 0, unidades: 0 };
        const contadorProductos = {};
        for (const dp of detallesProductos) {
            const nombre = dp.nombre;
            if (!contadorProductos[nombre]) {
                contadorProductos[nombre] = { unidades: 0, precio: dp.precio };
            }
            contadorProductos[nombre].unidades += dp.cantidad;
        }
        
        let maxUnidades = 0;
        for (const [nombre, datos] of Object.entries(contadorProductos)) {
            if (datos.unidades > maxUnidades) {
                maxUnidades = datos.unidades;
                bestSeller = { nombre, precio: datos.precio, unidades: datos.unidades };
            }
        }
        
        const respuestaPrueba = {
            nombre: empresa[0].nombre,
            tipo: empresa[0].tipo || "Comercio",
            resumenFinanciero: { revenueTotal: ingresos },
            graficoBarras: { 
                labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'], 
                valores: [0, 0, 0, 0, 0, 0] 
            },
            graficoDona: { completados, procesando, cancelados },
            bestSeller: bestSeller
        };
        
        return res.status(200).json(respuestaPrueba);
        
    } catch (error) {
        console.error("❌ Error crítico:", error);
        return res.status(500).json({ error: "Error interno del servidor", detalle: error.message });
    }
});

app.get('/api/empresa/de-usuario/:id_usuario', async (req, res) => {
    const id_usuario = req.params.id_usuario;
    console.log(`🔍 Buscando empresa para usuario ID: ${id_usuario}`);
    
    try {
        const [empresa] = await pool.execute(
            'SELECT id_empresa FROM EMPRESA WHERE id_usuario = ?', 
            [id_usuario]
        );
        
        if (empresa.length === 0) {
            return res.status(404).json({ error: "Empresa no encontrada para este usuario" });
        }
        
        res.json({ id_empresa: empresa[0].id_empresa });
        
    } catch (err) {
        console.error("❌ Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pedidos/auto-asignar', async (req, res) => {
    const { id_pedido } = req.body;
    try {
        const [domiciliarios] = await pool.execute('SELECT id_domiciliario, nombre FROM DOMICILIARIO WHERE estado = "Disponible"');
        
        const paqueteData = {
            tarea: "asignar_repartidor",
            datos: {
                id_pedido: id_pedido,
                domiciliarios: domiciliarios
            }
        };

        const pythonProcess = spawn(process.platform === 'win32' ? 'python' : 'python3', ['analitica.py']);
        let salida = '';

        pythonProcess.stdout.on('data', (data) => {
            salida += data.toString();
        });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: "Error en Python" });
            }
            
            const respuestaPython = JSON.parse(salida);
            if (respuestaPython.status === "exitoso") {
                await pool.execute('UPDATE PEDIDO SET id_domiciliario = ?, estado = "Asignado" WHERE id_pedido = ?', 
                    [respuestaPython.id_domiciliario, respuestaPython.id_pedido]);
                await pool.execute('UPDATE DOMICILIARIO SET estado = "Ocupado" WHERE id_domiciliario = ?', 
                    [respuestaPython.id_domiciliario]);
                res.status(200).json({ mensaje: "Asignación completada", datos: respuestaPython });
            } else {
                res.status(400).json({ error: respuestaPython.mensaje });
            }
        });

        pythonProcess.stdin.write(JSON.stringify(paqueteData));
        pythonProcess.stdin.end();

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== TOP PRODUCTOS MÁS VENDIDOS ====================
app.get('/api/empresas/:id/top-productos', async (req, res) => {
    const id_empresa = req.params.id;
    
    try {
        const idNumerico = parseInt(id_empresa);
        if (isNaN(idNumerico)) {
            return res.status(400).json({ error: "ID de empresa inválido" });
        }
        
        const [productos] = await pool.execute(`
            SELECT 
                p.id_producto,
                p.nombre,
                p.precio,
                SUM(dp.cantidad) as total_vendido
            FROM PRODUCTO p
            INNER JOIN DETALLE_PEDIDO dp ON p.id_producto = dp.id_producto
            INNER JOIN PEDIDO ped ON dp.id_pedido = ped.id_pedido
            WHERE p.id_empresa = ? AND ped.estado = 'Entregado'
            GROUP BY p.id_producto, p.nombre, p.precio
            ORDER BY total_vendido DESC
            LIMIT 10
        `, [idNumerico]);
        
        return res.status(200).json(productos);
        
    } catch (error) {
        console.error("❌ Error en top productos:", error.message);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ==================== ESTADÍSTICAS DE PRODUCTOS ====================
app.get('/api/empresas/:id/estadisticas-productos', async (req, res) => {
    const id_empresa = req.params.id;
    
    try {
        const idNumerico = parseInt(id_empresa);
        
        const [totalVendido] = await pool.execute(`
            SELECT COALESCE(SUM(dp.cantidad), 0) as total
            FROM DETALLE_PEDIDO dp
            INNER JOIN PEDIDO ped ON dp.id_pedido = ped.id_pedido
            WHERE ped.id_empresa = ? AND ped.estado = 'Entregado'
        `, [idNumerico]);
        
        const [productoMasCaro] = await pool.execute(`
            SELECT p.nombre, p.precio
            FROM PRODUCTO p
            INNER JOIN DETALLE_PEDIDO dp ON p.id_producto = dp.id_producto
            INNER JOIN PEDIDO ped ON dp.id_pedido = ped.id_pedido
            WHERE ped.id_empresa = ? AND ped.estado = 'Entregado'
            ORDER BY p.precio DESC
            LIMIT 1
        `, [idNumerico]);
        
        res.json({
            total_unidades_vendidas: totalVendido[0].total,
            producto_mas_caro: productoMasCaro[0] || null
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== DOMICILIARIOS ====================
app.post('/api/domiciliarios/registro', async (req, res) => {
    console.log("📥 Registro de domiciliario:", req.body);
    
    const { nombre, telefono, email, tipo_vehiculo, contrasena } = req.body;
    
    try {
        if (!nombre || !telefono || !email || !contrasena) {
            return res.status(400).json({ error: "Todos los campos son obligatorios" });
        }
        
        const [existe] = await pool.execute('SELECT id_domiciliario FROM DOMICILIARIO WHERE email = ?', [email]);
        if (existe.length > 0) {
            return res.status(400).json({ error: "Este correo ya está registrado" });
        }
        
        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);
        
        const [resultado] = await pool.execute(
            `INSERT INTO DOMICILIARIO (nombre, telefono, email, tipo_vehiculo, contraseña, estado) 
             VALUES (?, ?, ?, ?, ?, 'Disponible')`,
            [nombre, telefono, email, tipo_vehiculo || 'Moto', contrasenaEncriptada]
        );
        
        res.status(201).json({ 
            mensaje: "Domiciliario registrado con éxito", 
            id_domiciliario: resultado.insertId 
        });
        
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Obtener estado del domiciliario
app.get('/api/domiciliarios/:id/estado', async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await pool.execute('SELECT estado FROM DOMICILIARIO WHERE id_domiciliario = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: "Domiciliario no encontrado" });
        res.json({ estado: rows[0].estado });
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar estado del domiciliario
app.put('/api/domiciliarios/:id/estado', async (req, res) => {
    const id = req.params.id;
    const { estado } = req.body;
    console.log(`🔄 Actualizando domiciliario ${id} a estado: ${estado}`);
    try {
        const [resultado] = await pool.execute('UPDATE DOMICILIARIO SET estado = ? WHERE id_domiciliario = ?', [estado, id]);
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: "Domiciliario no encontrado" });
        }
        res.json({ mensaje: "Estado actualizado", estado: estado });
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Obtener pedidos activos del repartidor
app.get('/api/domiciliarios/:id/pedidos-activos', async (req, res) => {
    const id_domiciliario = req.params.id;
    console.log(`📋 Buscando pedidos activos para repartidor ${id_domiciliario}...`);
    
    try {
        const [pedidos] = await pool.execute(`
            SELECT 
                p.id_pedido, 
                p.total, 
                p.estado,
                e.nombre as empresa_nombre,
                u.nombre as cliente_nombre,
                u.telefono as cliente_telefono,
                COALESCE(u.direccion, 'Dirección no registrada') as cliente_direccion
            FROM PEDIDO p
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
            INNER JOIN USUARIO u ON p.id_usuario = u.id_usuario
            WHERE p.id_domiciliario = ? AND p.estado IN ('En camino', 'Preparacion')
            ORDER BY p.id_pedido DESC
        `, [id_domiciliario]);
        
        console.log(`✅ ${pedidos.length} pedidos activos encontrados`);
        res.json(pedidos);
        
    } catch (error) {
        console.error("❌ Error en pedidos-activos:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Obtener historial del repartidor
app.get('/api/domiciliarios/:id/historial', async (req, res) => {
    const id_domiciliario = req.params.id;
    console.log(`📋 Buscando historial para repartidor ${id_domiciliario}...`);
    
    try {
        const [pedidos] = await pool.execute(`
            SELECT 
                p.id_pedido, 
                p.total, 
                p.fecha,
                e.nombre as empresa_nombre
            FROM PEDIDO p
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
            WHERE p.id_domiciliario = ? AND p.estado = 'Entregado'
            ORDER BY p.id_pedido DESC
            LIMIT 20
        `, [id_domiciliario]);
        
        console.log(`✅ ${pedidos.length} pedidos completados encontrados`);
        res.json(pedidos);
        
    } catch (error) {
        console.error("❌ Error en historial:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Asignar pedido a repartidor - Ahora pasa a PREPARACIÓN, no a EN CAMINO
app.put('/api/pedidos/:id/asignar', async (req, res) => {
    const id_pedido = req.params.id;
    const { id_domiciliario } = req.body;
    let conexion;
    
    console.log(`🛵 Asignando pedido ${id_pedido} al repartidor ${id_domiciliario}`);
    
    try {
        conexion = await pool.getConnection();
        await conexion.beginTransaction();
        
        const [ped] = await conexion.execute('SELECT estado FROM PEDIDO WHERE id_pedido = ?', [id_pedido]);
        if (ped.length === 0) throw new Error('Pedido no encontrado');
        if (ped[0].estado !== 'Pendiente') throw new Error(`El pedido está en estado "${ped[0].estado}"`);
        
        const [dom] = await conexion.execute('SELECT estado FROM DOMICILIARIO WHERE id_domiciliario = ?', [id_domiciliario]);
        if (dom.length === 0) throw new Error('Domiciliario no encontrado');
        if (dom[0].estado !== 'Disponible') throw new Error('No estás disponible');
        
        // CAMBIO IMPORTANTE: estado a "Preparacion" en lugar de "En camino"
        await conexion.execute(
            'UPDATE PEDIDO SET id_domiciliario = ?, estado = "Preparacion" WHERE id_pedido = ?',
            [id_domiciliario, id_pedido]
        );
        await conexion.execute('UPDATE DOMICILIARIO SET estado = "Ocupado" WHERE id_domiciliario = ?', [id_domiciliario]);
        
        await conexion.commit();
        console.log(`✅ Pedido ${id_pedido} asignado (ahora en Preparación)`);
        res.json({ mensaje: "Pedido asignado exitosamente. Esperando confirmación de la empresa." });
        
    } catch (error) {
        if (conexion) await conexion.rollback();
        console.error("❌ Error:", error.message);
        res.status(400).json({ error: error.message });
    } finally {
        if (conexion) conexion.release();
    }
});

// Marcar pedido como entregado
// Marcar pedido como entregado (SOLO REPARTIDOR)
app.put('/api/pedidos/:id/entregar', async (req, res) => {
    const id_pedido = req.params.id;
    let conexion;
    
    console.log(`✅ Repartidor marcando pedido ${id_pedido} como entregado`);
    
    try {
        conexion = await pool.getConnection();
        await conexion.beginTransaction();
        
        const [ped] = await conexion.execute(
            'SELECT id_domiciliario, estado FROM PEDIDO WHERE id_pedido = ?',
            [id_pedido]
        );
        
        if (ped.length === 0) throw new Error('Pedido no encontrado');
        if (ped[0].estado !== 'En camino') throw new Error(`El pedido está en estado "${ped[0].estado}". Solo se puede entregar si está "En camino".`);
        
        await conexion.execute('UPDATE PEDIDO SET estado = "Entregado" WHERE id_pedido = ?', [id_pedido]);
        
        if (ped[0].id_domiciliario) {
            await conexion.execute(
                'UPDATE DOMICILIARIO SET estado = "Disponible" WHERE id_domiciliario = ?',
                [ped[0].id_domiciliario]
            );
        }
        
        await conexion.commit();
        console.log(`✅ Pedido ${id_pedido} entregado`);
        res.json({ mensaje: "Pedido entregado exitosamente" });
        
    } catch (error) {
        if (conexion) await conexion.rollback();
        console.error("❌ Error:", error.message);
        res.status(400).json({ error: error.message });
    } finally {
        if (conexion) conexion.release();
    }
});
// Empresa marca pedido como listo para entregar (cambia a "En camino")
app.put('/api/pedidos/:id/listo-para-entregar', async (req, res) => {
    const id_pedido = req.params.id;
    let conexion;
    
    console.log(`🍳 Empresa marcando pedido ${id_pedido} como listo para entregar`);
    
    try {
        conexion = await pool.getConnection();
        await conexion.beginTransaction();
        
        const [ped] = await conexion.execute(
            'SELECT id_domiciliario, estado FROM PEDIDO WHERE id_pedido = ?',
            [id_pedido]
        );
        
        if (ped.length === 0) throw new Error('Pedido no encontrado');
        if (ped[0].estado !== 'Preparacion') throw new Error(`El pedido está en estado "${ped[0].estado}". Debe estar en Preparación.`);
        if (!ped[0].id_domiciliario) throw new Error('El pedido no tiene un repartidor asignado');
        
        await conexion.execute('UPDATE PEDIDO SET estado = "En camino" WHERE id_pedido = ?', [id_pedido]);
        
        await conexion.commit();
        console.log(`✅ Pedido ${id_pedido} marcado como "En camino"`);
        res.json({ mensaje: "Pedido marcado como listo para entregar. El repartidor está en camino." });
        
    } catch (error) {
        if (conexion) await conexion.rollback();
        console.error("❌ Error:", error.message);
        res.status(400).json({ error: error.message });
    } finally {
        if (conexion) conexion.release();
    }
});

// ==================== ENDPOINT DE PRUEBA ====================
app.get('/api/test', (req, res) => {
    res.json({ mensaje: "Servidor funcionando", time: new Date() });
});

// ==================== INICIAR SERVIDOR ====================
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});