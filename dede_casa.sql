CREATE DATABASE IF NOT EXISTS desde_casa;
USE desde_casa;
select * from empresa;

-- 1. Tabla EMPRESA (Incluye la tarifa fija de envío)
CREATE TABLE EMPRESA (
    id_empresa INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    tipo VARCHAR(50),
    tarifa_envio DECIMAL(10, 2) NOT NULL DEFAULT 0.00 -- Tarifa fija por empresa
);
-- Asegurar que EMPRESA tenga credenciales para el Login corporativo
ALTER TABLE EMPRESA ADD COLUMN email VARCHAR(100) UNIQUE AFTER telefono;
ALTER TABLE EMPRESA ADD COLUMN contraseña VARCHAR(255) AFTER email;

-- Asegurar que DOMICILIARIO tenga credenciales para su propio Login operativo


-- Nota: La tabla USUARIO ya cuenta con email, contrasena y rol ('Cliente') en nuestro diseño previo.

-- 2. Tabla USUARIO
CREATE TABLE USUARIO (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    contraseña VARCHAR(255) NOT NULL,
    metodo_pago VARCHAR(50),
    rol VARCHAR(20) DEFAULT 'Cliente'
);

-- 3. Tabla DOMICILIARIO
CREATE TABLE DOMICILIARIO (
    id_domiciliario INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    estado VARCHAR(20) DEFAULT 'Disponible',
    id_vehiculo VARCHAR(50)
);
ALTER TABLE DOMICILIARIO ADD COLUMN email VARCHAR(100) UNIQUE AFTER telefono;
ALTER TABLE DOMICILIARIO ADD COLUMN contraseña VARCHAR(255) AFTER email;
-- 4. Tabla PRODUCTO
CREATE TABLE PRODUCTO (
    id_producto INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    descripcion TEXT,
    id_empresa INT,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESA(id_empresa) ON DELETE CASCADE
);

-- 5. Tabla PEDIDO
CREATE TABLE PEDIDO (
    id_pedido INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(30) DEFAULT 'Pendiente',
    total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    metodo_pago VARCHAR(50),
    id_usuario INT,
    id_domiciliario INT NULL,
    id_empresa INT,
    FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario),
    FOREIGN KEY (id_domiciliario) REFERENCES DOMICILIARIO(id_domiciliario) ON DELETE SET NULL,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESA(id_empresa)
);

-- 6. Tabla DETALLE_PEDIDO
CREATE TABLE DETALLE_PEDIDO (
    id_detalle INT AUTO_INCREMENT PRIMARY KEY,
    cantidad INT NOT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    id_pedido INT,
    id_producto INT,
    FOREIGN KEY (id_pedido) REFERENCES PEDIDO(id_pedido) ON DELETE CASCADE,
    FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto)
);
use desde_casa;
-- 1. Preparamos el terreno creando la columna de conexión en EMPRESA
ALTER TABLE EMPRESA ADD COLUMN id_usuario INT;
select * from usuario;
-- 2. Migración: Extraemos los datos de EMPRESA y los insertamos en USUARIO
-- Asignamos automáticamente el rol 'Empresa' a estos registros
INSERT INTO USUARIO (nombre, telefono, email, contraseña, rol)
SELECT nombre, telefono, email, contraseña, 'Empresa' 
FROM EMPRESA;

delete from usuario where id_usuario>=3;

-- 3. Enlace: Emparejamos el ID del nuevo usuario con su empresa correspondiente
-- Utilizamos el correo electrónico como puente para saber quién es quién
UPDATE EMPRESA e
INNER JOIN USUARIO u ON e.email = u.email
SET e.id_usuario = u.id_usuario
WHERE u.rol = 'Empresa';
select * from empresa;

-- 4. Seguridad: Aplicamos la llave foránea para mantener la integridad de los datos
ALTER TABLE EMPRESA 
ADD CONSTRAINT fk_empresa_usuario 
FOREIGN KEY (id_usuario) REFERENCES USUARIO(id_usuario) 
ON DELETE CASCADE;

-- 5. Limpieza: Como las credenciales ya están a salvo en USUARIO, borramos las columnas viejas
ALTER TABLE EMPRESA DROP COLUMN email, DROP COLUMN contraseña;