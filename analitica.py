import sys
import json
import io
import traceback
from datetime import datetime
import random

# Forzar UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')

def procesar_analitica_dashboard(datos):
    nombre = datos.get("nombre_empresa", "Establecimiento")
    tipo = datos.get("tipo_empresa", "Comercio")
    pedidos = datos.get("pedidos", [])
    detalles_productos = datos.get("detalles_productos", [])

    completados = 0
    procesando = 0
    cancelados = 0
    ingresos_brutos = 0.0
    ventas_por_mes = {}

    for p in pedidos:
        estado = p.get("estado")
        total_pedido = float(p.get("total") or 0.0)
        
        if estado == 'Entregado':
            completados += 1
            ingresos_brutos += total_pedido
            fecha_str = p.get("fecha")
            if fecha_str:
                try:
                    fecha_limpia = str(fecha_str).split("T")[0]
                    dt = datetime.strptime(fecha_limpia, "%Y-%m-%d")
                    mes_nombre = dt.strftime("%b")
                    ventas_por_mes[mes_nombre] = ventas_por_mes.get(mes_nombre, 0.0) + total_pedido
                except Exception:
                    pass
        elif estado in ['Pendiente', 'En camino', 'Asignado', 'Preparacion']:
            procesando += 1
        elif estado == 'Cancelado':
            cancelados += 1

    labels_meses = list(ventas_por_mes.keys())
    valores_meses = list(ventas_por_mes.values())

    if not labels_meses:
        labels_meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun']
        valores_meses = [0, 0, 0, 0, 0, 0]

    # Calcular best seller
    conteo_productos = {}
    for dp in detalles_productos:
        prod_nombre = dp.get("nombre")
        prod_precio = float(dp.get("precio") or 0.0)
        cantidad = int(dp.get("cantidad") or 0)

        if prod_nombre not in conteo_productos:
            conteo_productos[prod_nombre] = {"unidades": 0, "precio": prod_precio}
        conteo_productos[prod_nombre]["unidades"] += cantidad

    if conteo_productos:
        producto_max = max(conteo_productos, key=lambda k: conteo_productos[k]["unidades"])
        best_seller_final = {
            "nombre": producto_max,
            "precio": conteo_productos[producto_max]["precio"],
            "unidades": conteo_productos[producto_max]["unidades"]
        }
    else:
        best_seller_final = {
            "nombre": "Sin ventas registradas",
            "precio": 0.0,
            "unidades": 0
        }

    return {
        "nombre": nombre,
        "tipo": tipo,
        "resumenFinanciero": {"revenueTotal": ingresos_brutos},
        "graficoBarras": {"labels": labels_meses, "valores": valores_meses},
        "graficoDona": {"completados": completados, "procesando": procesando, "cancelados": cancelados},
        "bestSeller": best_seller_final
    }

def asignar_repartidor(datos):
    domiciliarios = datos.get("domiciliarios", [])
    id_pedido = datos.get("id_pedido")
    
    if not domiciliarios:
        return {
            "status": "fallido",
            "mensaje": "No hay domiciliarios disponibles"
        }
    
    # Asignar el primer disponible (o podrías usar un algoritmo más sofisticado)
    asignado = domiciliarios[0]
    
    return {
        "status": "exitoso",
        "id_pedido": id_pedido,
        "id_domiciliario": asignado["id_domiciliario"],
        "nombre_domiciliario": asignado["nombre"]
    }

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        if input_data and input_data.strip():
            paquete = json.loads(input_data)
            tarea = paquete.get("tarea")
            datos = paquete.get("datos")

            if tarea == "analitica_avanzada_dashboard":
                resultado = procesar_analitica_dashboard(datos)
                print(json.dumps(resultado))
            elif tarea == "asignar_repartidor":
                resultado = asignar_repartidor(datos)
                print(json.dumps(resultado))
            else:
                print(json.dumps({"error": f"Tarea desconocida: {tarea}"}))
                
    except Exception as e:
        error_dict = {
            "error_python": True,
            "mensaje": str(e),
            "detalle": traceback.format_exc()
        }
        print(json.dumps(error_dict))
        sys.exit(1)