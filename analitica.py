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
# ==================== NUEVAS FUNCIONES PARA REPARTIDORES ====================

def obtener_pedidos_pendientes(datos):
    """
    Procesa y filtra pedidos pendientes para mostrar a repartidores
    """
    pedidos = datos.get("pedidos", [])
    ubicacion_repartidor = datos.get("ubicacion", {"lat": 11.3789, "lng": -72.2425})
    
    pendientes = []
    for p in pedidos:
        if p.get("estado") == "Pendiente" and not p.get("id_domiciliario"):
            # Simular distancia basada en ID del pedido (para demostración)
            distancia = (p.get("id_pedido", 1) % 8) + 1
            tiempo_estimado = distancia * 5
            
            pendientes.append({
                "id_pedido": p.get("id_pedido"),
                "total": float(p.get("total") or 0),
                "empresa_nombre": p.get("empresa_nombre", "Empresa"),
                "distancia": distancia,
                "tiempo_estimado": tiempo_estimado,
                "recomendado": distancia <= 3  # Recomendar si está cerca
            })
    
    # Ordenar por distancia (más cercanos primero)
    pendientes.sort(key=lambda x: x["distancia"])
    
    return {
        "pedidos": pendientes,
        "total_pendientes": len(pendientes),
        "mejor_opcion": pendientes[0] if pendientes else None
    }


def recomendar_mejor_ruta(datos):
    """
    Recomienda la mejor ruta para múltiples pedidos
    """
    pedidos_asignados = datos.get("pedidos_asignados", [])
    
    if not pedidos_asignados:
        return {"mensaje": "No hay pedidos asignados", "ruta": []}
    
    # Ordenar por distancia simulada
    pedidos_con_distancia = []
    for p in pedidos_asignados:
        distancia = (p.get("id_pedido", 1) % 10) + 1
        pedidos_con_distancia.append({
            "id_pedido": p.get("id_pedido"),
            "empresa_nombre": p.get("empresa_nombre"),
            "direccion": p.get("direccion", "Dirección no especificada"),
            "distancia": distancia,
            "orden": 0
        })
    
    # Ordenar por distancia
    pedidos_con_distancia.sort(key=lambda x: x["distancia"])
    
    # Asignar orden
    for i, p in enumerate(pedidos_con_distancia, 1):
        p["orden"] = i
    
    return {
        "ruta_optimizada": pedidos_con_distancia,
        "total_km": sum(p["distancia"] for p in pedidos_con_distancia),
        "tiempo_estimado": sum(p["distancia"] for p in pedidos_con_distancia) * 5
    }


def calcular_ganancias_repartidor(datos):
    """
    Calcula ganancias de un repartidor
    """
    entregas = datos.get("entregas", [])
    tarifa_base = datos.get("tarifa_base", 3000)
    tarifa_km = datos.get("tarifa_km", 500)
    
    total_entregas = len(entregas)
    total_ganancias = 0
    detalle_entregas = []
    
    for entrega in entregas:
        distancia = entrega.get("distancia", 3)
        ganancia = tarifa_base + (distancia * tarifa_km)
        total_ganancias += ganancia
        
        detalle_entregas.append({
            "id_pedido": entrega.get("id_pedido"),
            "distancia": distancia,
            "ganancia": ganancia,
            "fecha": entrega.get("fecha", datetime.now().strftime("%Y-%m-%d"))
        })
    
    return {
        "total_entregas": total_entregas,
        "total_ganancias": total_ganancias,
        "detalle": detalle_entregas,
        "promedio_por_entrega": round(total_ganancias / total_entregas, 2) if total_entregas > 0 else 0
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
            
            # ===== NUEVAS TAREAS =====
            elif tarea == "pedidos_pendientes":
                resultado = obtener_pedidos_pendientes(datos)
                print(json.dumps(resultado))
                
            elif tarea == "recomendar_ruta":
                resultado = recomendar_mejor_ruta(datos)
                print(json.dumps(resultado))
                
            elif tarea == "calcular_ganancias":
                resultado = calcular_ganancias_repartidor(datos)
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