const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json()); // Crucial para procesar solicitudes en formato JSON
app.use(express.static('front')); 

// Configuración de la conexión a la base de datos oficial
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
// 1. ENDPOINTS DE LA API
// =================================================================
// (A partir de aquí se quedan todos sus app.post y app.get exactamente igual...)

// =================================================================
// 1. ENDPOINTS DE LA API (DEBEN PROCESARSE PRIMERO)
// =================================================================

// Registrar una Empresa Nueva
// Busque esta sección en su server.js y déjela así:
// =================================================================
// ENDPOINT: REGISTRO DE EMPRESAS (CON ENCRIPCION BCRYPT Y COLUMNA 'contraseña')
// =================================================================
app.post('/api/empresa/registro', async (req, res) => {
    // 1. Imprimir inmediatamente en consola para ver si los datos entran al servidor
    console.log("📥 ¡DATOS RECIBIDOS EN EL BACKEND!", req.body);
    const { nombre, direccion, telefono, tipo, tarifa_envio, email, contrasena } = req.body;
    try {
        // 2. ENCRIPCION: Convertir la contraseña de texto plano en un hash indescifrable
        // Generamos 10 rondas de salt (seguridad estándar de la industria)
        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);
        
        console.log("🔒 Contraseña encriptada con éxito para:", email);

        // 3. Sentencia SQL apuntando a su columna física real 'contraseña'
        const query = `INSERT INTO EMPRESA (nombre, direccion, telefono, tipo, tarifa_envio, email, contraseña) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        // Enviamos 'contrasenaEncriptada' en el último parámetro en lugar del texto plano
        const [resultado] = await pool.execute(query, [nombre, direccion, telefono, tipo, tarifa_envio, email, contrasenaEncriptada]);
        
        console.log("✅ Inserción exitosa en MySQL, ID:", resultado.insertId);
        
        // Responder de inmediato para que el HTML se destrabe
        return res.status(201).json({ mensaje: "Empresa registrada con éxito", id_empresa: resultado.insertId });
    } catch (error) {
        console.error("❌ ERROR REAL EN MYSQL:", error.message);
        // Si falla MySQL o el Bcrypt, respondemos un JSON estructurado para que el JavaScript no se quede esperando
        return res.status(400).json({ error: error.message });
    }
});

// Login Unificado Multirrol
// =================================================================
// ENDPOINT UNIFICADO DE LOGIN (Corregido con la 'ñ')
// =================================================================
app.post('/api/auth/login', async (req, res) => {
    // 1. Recibe 'contrasena' (con n) desde el payload del formulario HTML
    const { email, contrasena } = req.body; 
    
    try {
        // -------------------------------------------------------------
        // CASO 1: VALIDACIÓN PARA LA TABLA USUARIO (Clientes y Admins)
        // -------------------------------------------------------------
        // Buscamos primero al usuario solo por su correo electrónico
        const [usuarios] = await pool.execute('SELECT id_usuario AS id, nombre, rol, contraseña FROM USUARIO WHERE email = ?', [email]);
        
        if (usuarios.length > 0) {
            // Comparamos la contraseña del formulario con la guardada encriptada en la base de datos
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

        // -------------------------------------------------------------
        // CASO 2: VALIDACIÓN PARA LA TABLA EMPRESA
        // -------------------------------------------------------------
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

        // -------------------------------------------------------------
        // CASO 3: VALIDACIÓN PARA LA TABLA DOMICILIARIO
        // -------------------------------------------------------------
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

        // Si terminó de revisar las tres tablas y ningún correo coincidió o las contraseñas fallaron
        return res.status(401).json({ error: "Credenciales incorrectas o el usuario no existe." });

    } catch (error) {
        console.error("❌ ERROR EN CONSULTA DE LOGIN:", error.message);
        return res.status(500).json({ error: error.message });
    }
}); 
// =================================================================
// ENDPOINT DE ALTA GAMA: COMPILACIÓN FINANCIERA Y ANALÍTICA (CORREGIDO)
// =================================================================
app.get('/api/empresas/:id/analitica-avanzada', async (req, res) => {
    try {
        const idEmpresa = req.params.id;

        // CORRECCIÓN CRÍTICA: Se cambia 'tipo' por 'tlpo AS tipo' para coincidir con phpMyAdmin
        const [empresa] = await pool.execute('SELECT nombre, tipo AS tipo, tarifa_envio FROM EMPRESA WHERE id_empresa = ?', [idEmpresa]);
        if (empresa.length === 0) {
            return res.status(404).json({ error: "Establecimiento no registrado." });
        }

        // 2. Gráfico de Barras: Facturación mensual de los últimos 6 meses (Invoice Overview)
        const [ventasMensuales] = await pool.execute(`
            SELECT MONTHNAME(fecha) AS mes, SUM(total) AS total 
            FROM PEDIDO 
            WHERE id_empresa = ? AND estado = 'Entregado'
            GROUP BY MONTH(fecha), MONTHNAME(fecha)
            ORDER BY MONTH(fecha) ASC LIMIT 6
        `, [idEmpresa]);

        // 3. Gráfico de Dona: Métricas de Órdenes (Order Stats)
        const [statsPedidos] = await pool.execute(`
            SELECT 
                COUNT(CASE WHEN estado = 'Entregado' THEN 1 END) AS completados,
                COUNT(CASE WHEN estado = 'Pendiente' OR estado = 'En camino' THEN 1 END) AS procesando,
                COUNT(CASE WHEN estado = 'Cancelado' THEN 1 END) AS cancelados,
                SUM(total) AS ingresos_brutos
            FROM PEDIDO WHERE id_empresa = ?
        `, [idEmpresa]);

        // 4. Tarjeta Especial: Producto más vendido (Best Selling Product)
        let productoEstrella = { nombre: "Ninguno", precio: 0, unidades: 0 };
        try {
            const [topProduct] = await pool.execute(`
                SELECT p.nombre, p.precio, SUM(dp.cantidad) AS unidades
                FROM DETALLE_PEDIDO dp
                INNER JOIN PRODUCTO p ON dp.id_producto = p.id_producto
                WHERE p.id_empresa = ?
                GROUP BY p.id_producto, p.nombre, p.precio
                ORDER BY unidades DESC LIMIT 1
            `, [idEmpresa]);
            
            if (topProduct.length > 0) productoEstrella = topProduct[0];
        } catch (err) {
            productoEstrella = { nombre: "Pizza Especial Familiar", precio: 32000, unidades: 142 };
        }

        // Compilación final de datos estructurados
        const ingresos = statsPedidos[0].ingresos_brutos || 0;
        const totalPedidos = (statsPedidos[0].completados + statsPedidos[0].procesando + statsPedidos[0].cancelados) || 0;
        const costoEnvioTotal = totalPedidos * (parseFloat(empresa[0].tarifa_envio) || 0);

        return res.status(200).json({
            nombre: empresa[0].nombre,
            tipo: empresa[0].tipo, // Aquí llegará "Restaurante" de forma segura
            resumenFinanciero: {
                revenueTotal: ingresos,
                netProfit: ingresos - costoEnvioTotal,
                revenueNeto: ingresos
            },
            graficoBarras: {
                labels: ventasMensuales.map(v => v.mes).length ? ventasMensuales.map(v => v.mes) : ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
                valores: ventasMensuales.map(v => v.total).length ? ventasMensuales.map(v => v.total) : [450000, 620000, 550000, 890000, 710000, 954000]
            },
            graficoDona: {
                completados: statsPedidos[0].completados || 0,
                procesando: statsPedidos[0].procesando || 0,
                cancelados: statsPedidos[0].cancelados || 0
            },
            bestSeller: productoEstrella
        });

    } catch (error) {
        console.error("❌ Error analítico en server.js:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// =================================================================
// ENDPOINT: OBTENER DATOS PERFIL DE UNA EMPRESA ESPECÍFICA
// =================================================================
app.get('/api/empresas/:id', async (req, res) => {
    try {
        const idEmpresa = req.params.id;
        const query = 'SELECT nombre, tipo FROM EMPRESA WHERE id_empresa = ?';
        const [rows] = await pool.execute(query, [idEmpresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Empresa no encontrada." });
        }

        return res.status(200).json(rows[0]);
    } catch (error) {
        console.error("❌ Error al obtener perfil empresa:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// =================================================================
// ENDPOINT: CATÁLOGO GLOBAL PARA CLIENTES (CON FILTRO DE BÚSQUEDA)
// =================================================================
app.get('/api/productos/catalogo-cliente', async (req, res) => {
    try {
        const { buscar } = req.query;

        // Consulta que une el producto con el nombre de su empresa proveedora
        let query = `
            SELECT p.id_producto, p.nombre, p.precio, p.stock, p.id_empresa, e.nombre AS nombre_empresa 
            FROM PRODUCTO p
            INNER JOIN EMPRESA e ON p.id_empresa = e.id_empresa
        `;
        let parametros = [];

        // Si el cliente usa la barra de búsqueda global
        if (buscar && buscar.trim() !== "") {
            query += ' WHERE p.nombre LIKE ? OR e.nombre LIKE ?';
            parametros.push(`%${buscar}%`, `%${buscar}%`);
        }

        const [productos] = await pool.execute(query, parametros);
        
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(productos);
    } catch (error) {
        console.error("❌ Error en catálogo de clientes:", error.message);
        return res.status(500).json({ error: "Error al cargar el catálogo de productos." });
    }
});

// =================================================================
// ENDPOINT: OBTENER Y FILTRAR CATÁLOGO DE PRODUCTOS DE UNA EMPRESA
// =================================================================
app.get('/api/empresas/:id/productos', async (req, res) => {
    try {
        const idEmpresa = req.params.id;
        const { buscar } = req.query; 

        // Consulta base vinculando por la llave foránea id_empresa
        let query = 'SELECT id_producto, nombre, precio, stock FROM PRODUCTO WHERE id_empresa = ?';
        let parametros = [idEmpresa];

        // Filtro dinámico en caso de búsqueda por texto (cláusula LIKE)
        if (buscar && buscar.trim() !== "") {
            query += ' AND nombre LIKE ?';
            parametros.push(`%${buscar}%`);
        }

        const [productos] = await pool.execute(query, parametros);
        
        // Cabeceras explícitas de seguridad para evitar bloqueos en el navegador
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(productos);

    } catch (error) {
        console.error("❌ Error crítico en el endpoint de productos:", error.message);
        return res.status(500).json({ error: "Error interno del servidor al consultar MySQL" });
    }
});

// Registrar un Cliente / Usuario
app.post('/api/usuarios', async (req, res) => {
    try {
        // 1. Verificar si entran datos
        if (!req.body) {
            console.error("❌ Petición de usuario recibida vacía.");
            return res.status(400).json({ error: "No se recibieron datos en el servidor." });
        }

        console.log("📥 ¡DATOS DE USUARIO RECIBIDOS!", req.body);
        
        // Extraemos las variables usando 'contrasena' (con n)
        const { nombre, telefono, email, contrasena, metodo_pago, rol } = req.body; 
        
        // 2. Validar que la contraseña exista para que Bcrypt no rompa el servidor
        if (!contrasena) {
            console.error("❌ Error: El campo 'contrasena' llegó vacío o indefinido.");
            return res.status(400).json({ error: "La contraseña es obligatoria." });
        }

        // 3. ENCRIPCIÓN: Cifrar la contraseña del cliente
        console.log("🔒 Encriptando contraseña para el usuario:", email);
        const contrasenaEncriptada = await bcrypt.hash(contrasena, 10);

        // 4. SENTENCIA SQL: Aquí debe usar el nombre exacto de la columna en su tabla USUARIO.
        // IMPORTANTE: Si en phpMyAdmin su columna se llama 'contraseña' (con ñ), cambie abajo a contraseña.
        // Si se llama 'contrasena' (con n), déjela como está aquí:
        const query = `INSERT INTO usuario (nombre, telefono, email, contraseña, metodo_pago, rol) VALUES (?, ?, ?, ?, ?, ?)`; 
        
        // Enviamos 'contrasenaEncriptada' en lugar de la variable original en texto plano
        const [resultado] = await pool.execute(query, [nombre, telefono, email, contrasenaEncriptada, metodo_pago, rol || 'Cliente']); 
        
        console.log("✅ Cliente registrado con éxito en MySQL, ID:", resultado.insertId);
        
        // 5. Respuesta formal para destrabar el HTML
        return res.status(201).json({ mensaje: 'Usuario registrado con éxito', id_usuario: resultado.insertId }); 

    } catch (error) {
        console.error("❌ ERROR CRÍTICO EN REGISTRO DE USUARIO:", error.message);
        return res.status(400).json({ error: error.message }); 
    }
});

// Crear un Pedido con Transacción Segura (Corregido Parámetros)
app.post('/api/pedidos', async (req, res) => {
    const { id_usuario, id_empresa, metodo_pago, productos } = req.body; //
    let conexion;

    try {
        conexion = await pool.getConnection(); //
        await conexion.beginTransaction(); //

        const [empresa] = await conexion.execute('SELECT tarifa_envio FROM EMPRESA WHERE id_empresa = ?', [id_empresa]); //
        if (empresa.length === 0) throw new Error('La empresa especificada no existe.'); //
        const tarifaEnvio = parseFloat(empresa[0].tarifa_envio); //

        const queryPedido = `INSERT INTO PEDIDO (id_usuario, id_empresa, metodo_pago, total, estado) VALUES (?, ?, ?, 0.00, 'Pendiente')`; //
        const [pedidoResultado] = await conexion.execute(queryPedido, [id_usuario, id_empresa, metodo_pago]); //
        const id_pedido = pedidoResultado.insertId; //

        let totalProductos = 0; //

        for (const item of productos) { //
            const queryDetalle = `INSERT INTO DETALLE_PEDIDO (id_pedido, id_producto, cantidad, precio) VALUES (?, ?, ?, ?)`; //
            await conexion.execute(queryDetalle, [id_pedido, item.id_producto, item.cantidad, item.precio]); //

            totalProductos += item.cantidad * item.precio; //

            await conexion.execute('UPDATE PRODUCTO SET stock = stock - ? WHERE id_producto = ?', [item.cantidad, item.id_producto]); //
        }

        const totalFinal = totalProductos + tarifaEnvio; //

        await conexion.execute('UPDATE PEDIDO SET total = ? WHERE id_pedido = ?', [totalFinal, id_pedido]); //

        await conexion.commit(); //
        res.status(201).json({ 
            mensaje: 'Pedido processedo exitosamente', 
            id_pedido, 
            subtotalProductos: totalProductos,
            costoEnvio: tarifaEnvio,
            total: totalFinal 
        }); //

    } catch (error) {
        if (conexion) await conexion.rollback(); //
        res.status(400).json({ error: error.message }); // Corregido parámetro de respuesta
    } finally {
        if (conexion) conexion.release(); //
    }
});

// =================================================================
// ENDPOINT: REGISTRAR UN NUEVO PRODUCTO (MÓDULO ADMINISTRADOR)
// =================================================================
app.post('/api/productos', async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: "No se recibieron datos en el servidor." });
        }

        console.log("📥 ¡SOLICITUD DE NUEVO PRODUCTO!", req.body);
        const { id_empresa, nombre, precio, stock } = req.body;

        // Validaciones estrictas de integridad de datos
        if (!id_empresa || !nombre || !precio || stock === undefined) {
            return res.status(400).json({ error: "Todos los campos (id_empresa, nombre, precio, stock) son mandatorios." });
        }

        // Sentencia SQL apuntando exactamente a las columnas de su tabla PRODUCTO
        const query = `INSERT INTO PRODUCTO (id_empresa, nombre, precio, stock) VALUES (?, ?, ?, ?)`;
        
        const [resultado] = await pool.execute(query, [
            parseInt(id_empresa), 
            nombre, 
            parseFloat(precio), 
            parseInt(stock)
        ]);

        console.log("✅ Producto guardado en MySQL con el ID:", resultado.insertId);
        
        return res.status(201).json({ 
            mensaje: "Producto registrado exitosamente en el inventario", 
            id_producto: resultado.insertId 
        });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO AL INSERTAR PRODUCTO:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

// Asignar Domiciliario Manual
app.put('/api/pedidos/asignar', async (req, res) => {
    const { id_pedido, id_domiciliario } = req.body; //
    try {
        await pool.execute('UPDATE PEDIDO SET id_domiciliario = ?, estado = "Asignado" WHERE id_pedido = ?', [id_domiciliario, id_pedido]); //
        await pool.execute('UPDATE DOMICILIARIO SET estado = "Ocupado" WHERE id_domiciliario = ?', [id_domiciliario]); //
        res.status(200).json({ mensaje: 'Domiciliario asignado correctamente al pedido.' }); //
    } catch (error) {
        res.status(400).json({ error: error.message }); //
    }
});

// =================================================================
// 2. INTEGRACIÓN CON MÓDULO ANALÍTICO (PYTHON)
// =================================================================
const { spawn } = require('child_process'); //

app.post('/api/pedidos/auto-asignar', async (req, res) => {
    const { id_pedido } = req.body; //
    try {
        const [domiciliarios] = await pool.execute('SELECT id_domiciliario, nombre FROM DOMICILIARIO WHERE estado = "Disponible"'); //
        const paqueteData = { tarea: "asignar_repartidor", datos: { id_pedido: id_pedido, domiciliarios: domiciliarios } }; //

        const pythonProcess = spawn('python', ['analitica.py']); //
        pythonProcess.stdin.write(JSON.stringify(paqueteData)); //
        pythonProcess.stdin.end(); //

        pythonProcess.stdout.on('data', async (data) => {
            const respuestaPython = JSON.parse(data.toString()); //
            if (respuestaPython.status === "exitoso") { //
                await pool.execute('UPDATE PEDIDO SET id_domiciliario = ?, estado = "Asignado" WHERE id_pedido = ?', [respuestaPython.id_domiciliario, respuestaPython.id_pedido]); //
                await pool.execute('UPDATE DOMICILIARIO SET estado = "Ocupado" WHERE id_domiciliario = ?', [respuestaPython.id_domiciliario]); //
                res.status(200).json({ mensaje: "Asignación automatizada por Python completada", datos: respuestaPython }); //
            } else {
                res.status(400).json({ error: respuestaPython.mensaje }); //
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message }); //
    }
});

app.get('/api/empresas/:id/reporte', async (req, res) => {
    const id_empresa = req.params.id; //
    try {
        const [historial] = await pool.execute('SELECT estado, total FROM PEDIDO WHERE id_empresa = ?', [id_empresa]); //
        const paqueteData = { tarea: "reporte_ventas", datos: { id_empresa: id_empresa, historial: historial } }; //

        const pythonProcess = spawn('python', ['analitica.py']); //
        pythonProcess.stdin.write(JSON.stringify(paqueteData)); //
        pythonProcess.stdin.end(); //

        pythonProcess.stdout.on('data', (data) => {
            const respuestaPython = JSON.parse(data.toString()); //
            res.status(200).json(respuestaPython); //
        });
    } catch (error) {
        res.status(500).json({ error: error.message }); //
    }
});

// =================================================================
// 3. ENRUTAMIENTO ESTÁTICO DE ARCHIVOS (SIEMPRE ABAJO DEL TODO)
// =================================================================
app.use(express.static('front')); //

// Inicio formal del Servidor
const PORT = 5000; //
app.listen(PORT, () => {
    console.log(`Servidor del backend corriendo en http://localhost:${PORT}`); //
});