const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json()); 
app.use(express.static('front')); // Enrutamiento de interfaz estática

// Configuración del pool de conexiones a la base de datos oficial
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',       
    password: '',       
    database: 'desde_casa', 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// =================================================================
// 1. ENDPOINTS DE AUTENTICACIÓN Y REGISTRO
// =================================================================

// Registrar una Empresa Nueva
app.post('/api/empresa/registro', async (req, res) => {
    console.log("📥 ¡DATOS RECIBIDOS EN EL BACKEND!", req.body);
    const { nombre, direccion, telefono, tipo, tarifa_envio, email, contrasena } = req.body;
    try {
        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);
        console.log("🔒 Contraseña encriptada con éxito para:", email);

        const query = `INSERT INTO EMPRESA (nombre, direccion, telefono, tipo, tarifa_envio, email, contraseña) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const [resultado] = await pool.execute(query, [nombre, direccion, telefono, tipo, tarifa_envio, email, contrasenaEncriptada]);
        
        console.log("✅ Inserción exitosa en MySQL, ID:", resultado.insertId);
        return res.status(201).json({ mensaje: "Empresa registrada con éxito", id_empresa: resultado.insertId });
    } catch (error) {
        console.error("❌ ERROR REAL EN MYSQL:", error.message);
        return res.status(400).json({ error: error.message });
    }
});

// Login Unificado Multirrol
app.post('/api/auth/login', async (req, res) => {
    const { email, contrasena } = req.body; 
    try {
        // CASO 1: CLIENTES Y ADMINS
        const [usuarios] = await pool.execute('SELECT id_usuario AS id, nombre, rol, contraseña FROM USUARIO WHERE email = ?', [email]);
        if (usuarios.length > 0) {
            const coincideUsuario = await bcrypt.compare(contrasena, usuarios[0].contraseña);
            if (coincideUsuario) {
                return res.status(200).json({ 
                    mensaje: "Login exitoso", 
                    rol: usuarios[0].rol, 
                    id: usuarios[0].id, 
                    nombre: usuarios[0].nombre 
                });
            }
        }

        // CASO 2: EMPRESAS
        const [empresas] = await pool.execute('SELECT id_empresa AS id, nombre, contraseña FROM EMPRESA WHERE email = ?', [email]);
        if (empresas.length > 0) {
            const coincideEmpresa = await bcrypt.compare(contrasena, empresas[0].contraseña);
            if (coincideEmpresa) {
                return res.status(200).json({ 
                    mensaje: "Login exitoso", 
                    rol: 'Empresa', 
                    id: empresas[0].id, 
                    nombre: empresas[0].nombre 
                });
            }
        }

        // CASO 3: DOMICILIARIOS
        const [domiciliarios] = await pool.execute('SELECT id_domiciliario AS id, nombre, contraseña FROM DOMICILIARIO WHERE email = ?', [email]);
        if (domiciliarios.length > 0) {
            const coincideDomiciliario = await bcrypt.compare(contrasena, domiciliarios[0].contraseña);
            if (coincideDomiciliario) {
                return res.status(200).json({ 
                    mensaje: "Login exitoso", 
                    rol: 'Domiciliario', 
                    id: domiciliarios[0].id, 
                    nombre: domiciliarios[0].nombre 
                });
            }
        }

        return res.status(401).json({ error: "Credenciales incorrectas o el usuario no existe." });
    } catch (error) {
        console.error("❌ ERROR EN CONSULTA DE LOGIN:", error.message);
        return res.status(500).json({ error: error.message });
    }
}); 

// Registrar un Cliente / Usuario
app.post('/api/usuarios', async (req, res) => {
    try {
        if (!req.body) return res.status(400).json({ error: "No se recibieron datos." });
        const { nombre, telefono, email, contrasena, metodo_pago, rol } = req.body; 
        
        if (!contrasena) return res.status(400).json({ error: "La contraseña es obligatoria." });

        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);
        const query = `INSERT INTO usuario (nombre, telefono, email, contraseña, metodo_pago, rol) VALUES (?, ?, ?, ?, ?, ?)`; 
        const [resultado] = await pool.execute(query, [nombre, telefono, email, contrasenaEncriptada, metodo_pago, rol || 'Cliente']); 
        
        return res.status(201).json({ mensaje: 'Usuario registrado con éxito', id_usuario: resultado.insertId }); 
    } catch (error) {
        console.error("❌ ERROR CRÍTICO EN REGISTRO DE USUARIO:", error.message);
        return res.status(400).json({ error: error.message }); 
    }
});

// =================================================================
// 2. ENDPOINTS DE PRODUCTOS Y BUSCADORES (OPTIMIZADOS)
// =================================================================

// NUEVA OPTIMIZACIÓN: Buscador de productos del cliente (Resuelve "Error al sincronizar con el backend")
// Soporta consultas generales y búsquedas específicas por ID de empresa o texto plano
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
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(productos);
    } catch (error) {
        console.error("❌ Error en catálogo de clientes:", error.message);
        return res.status(500).json({ error: "Error interno al procesar el catálogo." });
    }
});

// Catálogo específico por Empresa con soporte de Query Params alternativos
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
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(productos);
    } catch (error) {
        console.error("❌ Error crítico en el endpoint de productos:", error.message);
        return res.status(500).json({ error: "Error interno del servidor al consultar MySQL" });
    }
});

// Guardar nuevo producto en el catálogo (Dashboard Empresa)
app.post('/api/productos', async (req, res) => {
    try {
        const { id_empresa, nombre, precio, stock } = req.body;
        if (!id_empresa || !nombre || !precio || stock === undefined) {
            return res.status(400).json({ error: "Todos los campos son mandatorios." });
        }

        const query = `INSERT INTO PRODUCTO (id_empresa, nombre, precio, stock) VALUES (?, ?, ?, ?)`;
        const [resultado] = await pool.execute(query, [parseInt(id_empresa), nombre, parseFloat(precio), parseInt(stock)]);
        
        return res.status(201).json({ mensaje: "Producto registrado exitosamente", id_producto: resultado.insertId });
    } catch (error) {
        console.error("❌ ERROR CRÍTICO AL INSERTAR PRODUCTO:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// =================================================================
// 3. ENDPOINTS DE PEDIDOS HISTORIAL Y TRANSACCIONES
// =================================================================

// NUEVA AGREGACIÓN: Historial de pedidos por usuario (Resuelve "Error al conectar con el servidor de datos")
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
        console.error("❌ Error al obtener el historial de pedidos:", error.message);
        return res.status(500).json({ error: "Error al sincronizar el historial desde la base de datos." });
    }
});

// Crear un Pedido con Transacción Atómica Completa
app.post('/api/pedidos', async (req, res) => {
    const { id_usuario, id_empresa, metodo_pago, productos } = req.body; 
    let conexion;
    try {
        conexion = await pool.getConnection(); 
        await conexion.beginTransaction(); 

        const [empresa] = await conexion.execute('SELECT tarifa_envio FROM EMPRESA WHERE id_empresa = ?', [id_empresa]); 
        if (empresa.length === 0) throw new Error('La empresa especificada no existe.'); 
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
        res.status(201).json({ 
            mensaje: 'Pedido procesado exitosamente', 
            id_pedido, 
            total: totalFinal 
        }); 
    } catch (error) {
        if (conexion) await conexion.rollback(); 
        res.status(400).json({ error: error.message }); 
    } finally {
        if (conexion) conexion.release(); 
    }
});

// =================================================================
// ENDPOINT: OBTENER EL ESTADO EN TIEMPO REAL DE UN PEDIDO ESPECÍFICO
// =================================================================
app.get('/api/pedidos/:id', async (req, res) => {
    try {
        const idPedido = req.params.id;
        const [rows] = await pool.execute('SELECT id_pedido, estado, total FROM PEDIDO WHERE id_pedido = ?', [idPedido]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Pedido no localizado en el sistema." });
        }
        
        return res.status(200).json(rows[0]);
    } catch (error) {
        console.error("❌ Error al consultar estado del pedido:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// =================================================================
// 4. MÓDULO DE ANALÍTICA AVANZADA Y PERFILES
// =================================================================
app.get('/api/empresas/:id/analitica-avanzada', async (req, res) => {
    try {
        const idEmpresa = req.params.id;

        const [empresa] = await pool.execute('SELECT nombre, tipo FROM EMPRESA WHERE id_empresa = ?', [idEmpresa]);
        if (empresa.length === 0) return res.status(404).json({ error: "Establecimiento no registrado." });

        const [pedidosCrudos] = await pool.execute('SELECT total, estado, fecha FROM PEDIDO WHERE id_empresa = ?', [idEmpresa]);
        const [productosVendidosCrudos] = await pool.execute(`
            SELECT p.nombre, p.precio, dp.cantidad
            FROM DETALLE_PEDIDO dp
            INNER JOIN PRODUCTO p ON dp.id_producto = p.id_producto
            WHERE p.id_empresa = ?
        `, [idEmpresa]);

        const paqueteData = {
            tarea: "analitica_avanzada_dashboard",
            datos: { nombre_empresa: empresa[0].nombre, tipo_empresa: empresa[0].tipo, pedidos: pedidosCrudos, detalles_productos: productosVendidosCrudos }
        };

        const pythonProcess = spawn('python', ['analitica.py']);
        
        let respuestaData = ""; // 🛡️ EL ACUMULADOR DE DATOS CRÍTICO

        pythonProcess.stdin.write(JSON.stringify(paqueteData));
        pythonProcess.stdin.end();

        // 1. Recibimos y unimos todos los fragmentos sin parsear aún
        pythonProcess.stdout.on('data', (data) => {
            respuestaData += data.toString();
        });

        // 2. Parseamos el JSON SOLO cuando el proceso de Python termine por completo
        pythonProcess.stdout.on('end', () => {
            try {
                const jsonProcesado = JSON.parse(respuestaData.trim());
                
                // Si Python nos avisa de un error interno, lo mostramos limpiamente
                if (jsonProcesado.error_python) {
                    console.error("❌ Fallo lógico en Python:", jsonProcesado.detalle);
                    return res.status(500).json({ error: jsonProcesado.mensaje });
                }
                
                return res.status(200).json(jsonProcesado);
            } catch (jsonErr) {
                console.error("❌ Error Fatal al parsear JSON. Python envió esto:", respuestaData);
                return res.status(500).json({ error: "Fallo de comunicación estructurada con el motor analítico." });
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`⚠️ Advertencia en consola de Python: ${data.toString()}`);
        });

    } catch (error) {
        console.error("❌ Fallo general en el puente Node-Python:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// =================================================================
// ENDPOINT: OBTENER TODOS LOS PEDIDOS ASOCIADOS A UNA EMPRESA
// =================================================================
app.get('/api/pedidos/empresa/:id', async (req, res) => {
    const idEmpresa = req.params.id;
    console.log(`📥 Consultando pedidos entrantes para la empresa ID: ${idEmpresa}`);
    
    try {
        // Consultamos la tabla PEDIDO ordenando por los más recientes primero
        const [rows] = await pool.execute(
            'SELECT id_pedido, total, estado, metodo_pago FROM PEDIDO WHERE id_empresa = ? ORDER BY id_pedido DESC',
            [idEmpresa]
        );

        // Si no hay filas, respondemos con una lista vacía en lugar de un error 404
        return res.status(200).json(rows);
        
    } catch (error) {
        console.error("❌ Error en MySQL al traer pedidos de la empresa:", error.message);
        return res.status(500).json({ error: "Error interno del servidor al procesar la consulta." });
    }
});

// =================================================================
// 5. INTEGRACIÓN CON MÓDULO INTELIGENTE (PYTHON PYTHON CHILD_PROCESS)
// =================================================================
const { spawn } = require('child_process');

app.post('/api/pedidos/auto-asignar', async (req, res) => {
    const { id_pedido } = req.body; 
    try {
        const [domiciliarios] = await pool.execute('SELECT id_domiciliario, nombre FROM DOMICILIARIO WHERE estado = "Disponible"'); 
        const paqueteData = { tarea: "asignar_repartidor", datos: { id_pedido: id_pedido, domiciliarios: domiciliarios } }; 

        const pythonProcess = spawn('python', ['analitica.py']); 
        pythonProcess.stdin.write(JSON.stringify(paqueteData)); 
        pythonProcess.stdin.end(); 

        pythonProcess.stdout.on('data', async (data) => {
            const respuestaPython = JSON.parse(data.toString()); 
            if (respuestaPython.status === "exitoso") { 
                await pool.execute('UPDATE PEDIDO SET id_domiciliario = ?, estado = "Asignado" WHERE id_pedido = ?', [respuestaPython.id_domiciliario, respuestaPython.id_pedido]); 
                await pool.execute('UPDATE DOMICILIARIO SET estado = "Ocupado" WHERE id_domiciliario = ?', [respuestaPython.id_domiciliario]); 
                res.status(200).json({ mensaje: "Asignación automatizada por Python completada", datos: respuestaPython }); 
            } else {
                res.status(400).json({ error: respuestaPython.mensaje }); 
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message }); 
    }
});

app.get('/api/empresas/:id/reporte', async (req, res) => {
    const id_empresa = req.params.id; 
    try {
        const [historial] = await pool.execute('SELECT estado, total FROM PEDIDO WHERE id_empresa = ?', [id_empresa]); 
        const paqueteData = { tarea: "reporte_ventas", datos: { id_empresa: id_empresa, historial: historial } }; 

        const pythonProcess = spawn('python', ['analitica.py']); 
        pythonProcess.stdin.write(JSON.stringify(paqueteData)); 
        pythonProcess.stdin.end(); 

        pythonProcess.stdout.on('data', (data) => {
            const respuestaPython = JSON.parse(data.toString()); 
            res.status(200).json(respuestaPython); 
        });
    } catch (error) {
        res.status(500).json({ error: error.message }); 
    }
});

// Inicio formal del Servidor en puerto seguro
const PORT = 5000; 
app.listen(PORT, () => {
    console.log(`🚀 Servidor backend optimizado en: http://localhost:${PORT}`); 
});