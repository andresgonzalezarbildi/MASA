#!/usr/bin/env python3
"""Agrega alimentos y preparaciones uruguayas al catálogo de M.A.S.A.

Uso:
    python3 tools/agregar-alimentos-uruguayos-v2.py
    python3 tools/agregar-alimentos-uruguayos-v2.py data/opennutrition-es-general-ampliado.json
    python3 tools/agregar-alimentos-uruguayos-v2.py archivo_entrada.json archivo_salida.json

- Si no se indica salida, modifica el archivo de entrada y crea una copia .bak.
- No agrega un registro cuando su nombre o alguno de sus alias ya existe.
- Los valores de preparaciones compuestas son estimaciones genéricas por 100 g.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

SOURCE_UY = "Estimación nutricional genérica · Cocina uruguaya"
SOURCE_MIDES = "Receta de referencia MIDES · valores nutricionales estimados"
SOURCE_UDELAR = "Receta de referencia Udelar · valores nutricionales estimados"


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.casefold()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def stable_id(name: str) -> str:
    digest = hashlib.sha1(norm(name).encode("utf-8")).hexdigest()[:14]
    return f"fd_masa_uy_{digest}"


def food(
    name: str,
    calories: float,
    protein: float,
    fat: float,
    carbs: float,
    serving_g: float = 100,
    aliases: Sequence[str] = (),
    source: str = SOURCE_UY,
) -> Dict[str, Any]:
    return {
        "id": stable_id(name),
        "name": name,
        "aliases": list(dict.fromkeys(a for a in aliases if norm(a) != norm(name))),
        "per100g": {
            "calories": round(float(calories), 2),
            "protein": round(float(protein), 2),
            "fat": round(float(fat), 2),
            "carbs": round(float(carbs), 2),
        },
        "serving": {
            "metric": {"quantity": float(serving_g), "unit": "g"},
            "common": {"quantity": 1.0, "unit": "porción"},
        },
        "sourceName": source,
    }


ADDITIONS: List[Dict[str, Any]] = [
    # Comidas, panes, fiambres, parrilla y platos uruguayos indicados por el usuario.
    food("Chivito uruguayo", 245, 13.5, 14.0, 16.0, 320, ["Chivito", "Chivito al pan"]),
    food("Chivito canadiense", 270, 15.0, 17.0, 16.0, 380, ["Chivito canadiense al pan"]),
    food("Pastel criollo", 330, 7.0, 17.0, 39.0, 90, ["Pasteles criollos", "Pastel frito criollo"]),
    food("Pan catalán", 270, 8.5, 3.5, 51.0, 80, ["Pan catalan"]),
    food("Pan porteño", 275, 8.5, 4.0, 51.0, 80, ["Pan porteno"]),
    food("Pan marsellés", 275, 9.0, 3.0, 53.0, 75, ["Pan marselles"]),
    food("Pan tortuga", 285, 8.5, 4.5, 53.0, 70, ["Tortuga", "Pan de tortuga"]),
    food("Pan felipe", 275, 9.0, 2.5, 54.0, 80, ["Felipe", "Pan Felipe uruguayo"]),
    food("Pan de chicharrones", 365, 10.0, 17.0, 45.0, 80, ["Pan con chicharrones", "Pan de chicharrón"]),
    food("Rosca dulce", 345, 7.5, 11.0, 55.0, 80, ["Rosca de panadería"]),
    food("Bizcochos uruguayos surtidos", 420, 7.5, 23.0, 46.0, 50, ["Bizcochos", "Bizcocho uruguayo"]),
    food("Pan con grasa", 410, 8.0, 22.0, 46.0, 60, ["Galleta con grasa"]),
    food("Croissant de panadería", 405, 8.0, 21.0, 46.0, 60, ["Croazán", "Croazanes", "Croissant", "Cruasán"]),
    food("Margarita de crema pastelera", 355, 6.5, 14.0, 53.0, 85, ["Margarita", "Margaritas", "Bizcocho margarita"]),
    food("Bizcocho relleno", 390, 7.0, 20.0, 48.0, 70, ["Bizcochos rellenos"]),
    food("Jesuita", 410, 8.0, 23.0, 44.0, 70, ["Jesuitas", "Bizcocho jesuita"]),
    food("Olímpico", 235, 11.0, 12.0, 22.0, 220, ["Olímpicos", "Sandwich olímpico", "Sándwich olímpico"]),
    food("Refuerzo de fiambre", 260, 12.0, 13.0, 26.0, 180, ["Refuerzo", "Refuerzos"]),
    food("Húngara", 310, 14.0, 27.0, 3.0, 90, ["Húngaras", "Salchicha húngara"]),
    food("Pildoritas", 285, 12.0, 25.0, 3.0, 100, ["Salchichas pildoritas", "Pildorita"]),
    food("Picantina", 165, 1.5, 14.0, 8.0, 15, ["Salsa picantina", "Aderezo picantina"]),
    food("Húngara con panceta", 335, 15.0, 29.0, 3.0, 120, ["Húngaras con panceta"]),
    food("Pancho con panceta", 285, 12.0, 19.0, 19.0, 180, ["Panchos con panceta"]),
    food("Pancho a la porteña", 275, 12.0, 17.0, 21.0, 200, ["Panchos a la porteña", "Pancho a la portena"]),
    food("Chorizo ruso", 325, 15.0, 28.0, 3.0, 100, ["Chorizo tipo ruso"]),
    food("Bondiola de cerdo", 255, 25.0, 17.0, 0.5, 150, ["Bondiola", "Bondiola cocida"]),
    food("Morcilla dulce", 330, 11.0, 22.0, 24.0, 100, ["Morcilla dulce uruguaya"]),
    food("Morcillón", 350, 14.0, 31.0, 3.0, 100, ["Morcillon"]),
    food("Lomito canadiense", 215, 18.0, 12.0, 10.0, 250, ["Lomo canadiense al pan"]),
    food("Chorizo colorado", 455, 24.0, 38.0, 3.0, 50, ["Chorizo rojo", "Chorizo español colorado"]),
    food("Tortilla española", 170, 6.0, 10.0, 14.0, 200, ["Tortilla de papa", "Tortilla de patatas"]),
    food("Pamplona uruguaya", 245, 25.0, 15.0, 4.0, 220, ["Pamplona", "Pamplona de pollo", "Pamplona de cerdo"]),
    food("Choto a la parrilla", 265, 18.0, 21.0, 1.0, 120, ["Choto", "Choto uruguayo"]),
    food("Chinchulines a la parrilla", 285, 18.0, 23.0, 0.5, 120, ["Chinchulines", "Chinchulín"]),
    food("Milanesa en dos panes", 255, 12.5, 12.5, 25.0, 430, ["En dos panes", "Mila en dos panes"]),
    food("Pencas de acelga rebozadas", 150, 4.0, 7.0, 18.0, 180, ["Pencas", "Pencas de acelga", "Pencas a la marinera"]),
    food("Pastel de carne", 165, 9.0, 8.0, 15.0, 300, ["Pastel de papa y carne"]),
    food("Zapallitos rellenos de carne", 105, 8.0, 5.0, 7.0, 250, ["Zapallitos rellenos", "Zapallitos rellenos."]),
    food("Tomates rellenos", 125, 7.0, 7.0, 8.0, 220, ["Tomate relleno", "Tomates rellenos de arroz y atún"]),
    food("Capeletis con salsa caruso", 205, 8.5, 10.0, 21.0, 300, ["Capelletis caruso", "Capelettis a la caruso"]),
    food("Sorrentinos de jamón y queso", 225, 10.0, 9.0, 27.0, 250, ["Sorrentinos"]),
    food("Romanitos de jamón y queso", 215, 9.0, 8.0, 28.0, 250, ["Romanitos", "Ñoquis rellenos de jamón y queso"]),
    food("Queso Colonia", 365, 24.0, 29.0, 2.0, 30, ["Queso colonia"]),
    food("Requesón", 105, 12.0, 4.5, 3.5, 100, ["Ricota cremosa", "Requesón natural"]),
    food("Posta de pescado cocida", 135, 24.0, 4.0, 0.0, 180, ["Postas de pescado", "Posta de pescado"]),
    food("Chupín de pescado", 95, 9.0, 3.5, 7.0, 350, ["Chupín", "Chupin de pescado"]),
    food("Pescado al horno con papas", 135, 13.0, 5.0, 9.0, 350, ["Pescado al horno con papa"]),
    food("Ternera al horno", 205, 27.0, 10.0, 1.0, 220, ["Carne de ternera al horno"]),
    food("Puchero uruguayo", 105, 8.0, 4.0, 10.0, 400, ["Puchero", "Puchero criollo", "Puchero uruguayo o criollo"]),
    food("Pirón", 125, 1.5, 3.5, 23.0, 180, ["Piron", "Pirão", "Pirão de fariña"]),
    food("Feijoada con papas", 145, 8.0, 6.0, 16.0, 350, ["Feijoada con papa"]),
    food("Ensopado uruguayo", 90, 7.0, 3.0, 9.0, 400, ["Ensopado"]),
    food("Gofio", 365, 11.0, 6.0, 67.0, 30, ["Harina de gofio", "Gofio de cereales"]),
    food("Tapioca seca", 358, 0.2, 0.0, 88.7, 30, ["Tapioca", "Perlas de tapioca"]),
    food("Pescado en escabeche", 170, 17.0, 10.0, 3.0, 180, ["Pescado escabeche", "Pescado al escabeche"]),
    food("Ensalada mixta", 80, 1.2, 6.5, 5.0, 200, ["Ensalada mixta con aceite"]),
    food("Ensalada de chauchas, papa y huevo", 120, 4.0, 5.0, 15.0, 250, ["Chaucha papa y huevos", "Ensalada de chaucha, papa y huevo"]),
    food("Mostaza estilo La Pasiva", 145, 4.0, 9.0, 12.0, 15, ["Mostaza La Pasiva", "Mostaza la pasiva"]),
    food("Zapallo en almíbar", 160, 0.5, 0.1, 40.0, 120, ["Zapallo en almibar"]),
    food("Dulce de zapallo", 245, 0.5, 0.2, 61.0, 30, ["Dulce de calabaza"]),
    food("Dulce de higo", 260, 1.0, 0.3, 65.0, 30, ["Dulce de higos"]),
    food("Boniatos en almíbar", 180, 1.0, 0.2, 45.0, 130, ["Boñatos en almíbar", "Boniato en almíbar"]),
    food("Alfajor de maicena", 415, 5.5, 18.0, 59.0, 60, ["Afajor de maicena", "Alfajor maicena"]),
    food("Espejito", 390, 5.0, 15.0, 60.0, 55, ["Masita espejito", "Espejitos"]),
    food("Yo-yo", 420, 5.5, 20.0, 57.0, 65, ["Yo yo", "Yoyó", "Masita yo-yo"]),
    food("Salchichón de chocolate", 465, 6.0, 25.0, 54.0, 50, ["Salchichón de chocolate uruguayo"]),
    food("Damasquitos", 385, 5.0, 15.0, 59.0, 45, ["Damasquito", "Masitas damasquitos"]),
    food("Borracho", 335, 5.0, 10.0, 55.0, 90, ["Postre borracho", "Bizcocho borracho"]),
    food("Milhojas de dulce de leche", 410, 6.0, 19.0, 55.0, 100, ["Milhojas con dulce de leche"]),
    food("Chajá", 300, 4.0, 11.0, 47.0, 140, ["Postre Chajá", "Chaja"]),
    food("Massini", 330, 6.0, 18.0, 36.0, 110, ["Postre Massini"]),
    food("Ricardito", 440, 4.5, 20.0, 62.0, 35, ["Ricardito de chocolate"]),
    food("Polvito canario", 430, 5.0, 23.0, 52.0, 120, ["Polvito uruguayo"]),
    food("Asado uruguayo", 250, 26.0, 16.0, 0.0, 250, ["Asado", "Carne asada a la parrilla"]),
    food("Postre Martín Fierro", 285, 9.0, 12.0, 35.0, 100, ["Martín Fierro", "Martin Fierro", "Queso y dulce"]),
    food("Tortas fritas", 365, 7.0, 17.0, 48.0, 70, ["Torta frita"]),
    food("Dulce de leche", 315, 6.0, 7.5, 57.0, 20, ["Dulce de leche tradicional"]),
    food("Pebete de jamón y queso", 260, 12.0, 12.0, 29.0, 180, ["Pebete", "Pebetes"]),
    food("Canapés surtidos", 280, 10.0, 17.0, 23.0, 35, ["Canapés", "Canapes"]),
    food("Masitas secas", 430, 6.0, 20.0, 58.0, 30, ["Masitas", "Masas secas"]),
    food("Empanada de carne", 255, 10.5, 13.0, 24.0, 100, ["Empanadas", "Empanada criolla"]),
    food("Sándwich de jamón y queso", 250, 12.0, 11.0, 27.0, 160, ["Sandwiches", "Sándwiches", "Sandwich de jamón y queso"]),
    food("Sándwich caliente de jamón y queso", 285, 14.0, 15.0, 25.0, 180, ["Calientes", "Sandwich caliente", "Sándwich caliente"]),
    food("Medialuna", 390, 7.0, 19.0, 49.0, 50, ["Medialunas"]),
    food("Mortadela", 310, 16.0, 27.0, 2.0, 30, ["Mortadela feteada"]),
    food("Choripán", 290, 13.0, 19.0, 21.0, 190, ["Choripan", "Chorizo al pan"]),
    food("Revuelto Gramajo", 205, 9.0, 14.0, 12.0, 300, ["Gramajo", "Revuelto gramajo"]),
    food("Picada uruguaya", 330, 18.0, 27.0, 5.0, 180, ["Picada", "Picada de fiambres y quesos"]),
    food("Milanesa de carne", 245, 20.0, 13.0, 15.0, 150, ["Milanesa"]),
    food("Milanesa al pan", 250, 13.0, 12.0, 25.0, 280, ["Refuerzo de milanesa"]),
    food("Milanesa de berenjena", 180, 5.0, 9.0, 22.0, 150, ["De berenjena", "Berenjena milanesa"]),
    food("Milanesa rellena", 275, 20.0, 17.0, 14.0, 200, ["Rellena", "Milanesa rellena de jamón y queso"]),
    food("Milanesa napolitana", 255, 20.0, 15.0, 13.0, 250, ["Napolitana", "Milanesa a la napolitana"]),
    food("Milanesa a caballo", 245, 18.0, 16.0, 9.0, 250, ["A caballo", "Milanesa con huevo frito"]),
    food("Pascualina", 195, 8.0, 11.0, 18.0, 250, ["Tarta pascualina"]),
    food("Pizza muzzarella", 260, 11.0, 10.0, 34.0, 150, ["Pizza", "Pizza de muzzarella"]),
    food("Fainá", 215, 8.0, 7.0, 31.0, 100, ["Faina"]),
    food("Figazza", 250, 8.0, 8.0, 37.0, 140, ["Pizza figazza", "Fugazza"]),
    food("Polenta cocida", 75, 1.6, 0.6, 16.0, 250, ["Polenta"]),
    food("Canelones de carne y verdura", 155, 8.0, 7.0, 16.0, 300, ["Canelones"]),
    food("Tuco", 95, 5.0, 5.0, 8.0, 100, ["Salsa tuco", "Tuco de carne"]),
    food("Fariña", 360, 1.6, 0.5, 87.0, 30, ["Farinha", "Harina de mandioca tostada"]),
    food("Buseca", 115, 8.0, 5.0, 10.0, 350, ["Guiso de mondongo", "Buseca uruguaya"]),
    food("Guiso carrero", 105, 7.0, 4.0, 11.0, 400, ["Guiso de carro", "Carrero"]),
    food("Carbonada", 105, 7.0, 3.5, 12.0, 400, ["Carbonada criolla"]),
    food("Locro", 135, 8.0, 5.0, 15.0, 400, ["Locro criollo"]),
    food("Mazamorra", 105, 2.0, 1.0, 23.0, 220, ["Mazamorra de maíz"]),
    food("Lengua a la vinagreta", 175, 19.0, 10.0, 2.0, 150, ["Lengua vinagreta"]),
    food("Ensalada rusa", 145, 3.0, 9.0, 14.0, 200, ["Rusa", "Ensalada de papa, zanahoria y arvejas"]),
    food("Pionono relleno", 235, 9.0, 13.0, 21.0, 150, ["Ponono", "Pionono salado"]),
    food("Morrón relleno", 125, 7.0, 6.0, 11.0, 250, ["Morrones rellenos"]),
    food("Matambre relleno", 190, 22.0, 10.0, 3.0, 180, ["Matambre arrollado"]),
    food("Matambre a la leche", 185, 22.0, 9.0, 4.0, 200, ["Matambre cocido en leche"]),
    food("Salsa criolla", 70, 1.0, 5.0, 6.0, 30, ["Criolla", "Salsa criolla uruguaya"]),
    food("Chimichurri", 120, 1.0, 11.0, 5.0, 15, ["Salsa chimichurri"]),
    food("Dulce de membrillo", 275, 0.4, 0.1, 69.0, 30, ["Membrillo dulce"]),
    food("Dulce de batata", 250, 0.5, 0.2, 62.0, 30, ["Dulce de boniato"]),
    food("Alfajor", 430, 6.0, 20.0, 58.0, 60, ["Alfajor tradicional"]),
    food("Pasta frola", 380, 5.0, 15.0, 60.0, 90, ["Pastafrola", "Pasta flora"]),
    food("Huevos quimbos", 305, 7.0, 8.0, 51.0, 70, ["Huevo quimbo", "Quimbos"]),
    food("Torta alfajor", 405, 6.0, 18.0, 58.0, 100, ["Torta de alfajor"]),

    # Recetario Cocina básica uruguaya - MIDES.
    food("Fideos con salsa blanca", 165, 5.5, 5.0, 25.0, 300, source=SOURCE_MIDES),
    food("Fideos con salsa de tomate", 145, 5.0, 3.0, 26.0, 300, source=SOURCE_MIDES),
    food("Sopa de remolacha", 45, 1.2, 2.0, 6.0, 300, source=SOURCE_MIDES),
    food("Arroz con atún", 155, 9.0, 4.5, 20.0, 300, ["Arroz con atun"], SOURCE_MIDES),
    food("Tarta de atún", 195, 10.0, 10.0, 17.0, 250, ["Tarta de atun"], SOURCE_MIDES),
    food("Guiso de lentejas con arroz", 125, 6.0, 3.5, 18.0, 350, source=SOURCE_MIDES),
    food("Ensalada de arroz con lentejas y huevo", 145, 7.0, 5.0, 19.0, 300, source=SOURCE_MIDES),
    food("Torta fubá", 345, 6.0, 13.0, 51.0, 80, ["Torta Fuba", "Torta de harina de maíz"], SOURCE_MIDES),
    food("Arroz con leche", 130, 3.5, 3.0, 23.0, 180, source=SOURCE_MIDES),

    # Recomendaciones, recetas y algo más - Udelar, edición 7.
    food("Brochette de pollo al microondas", 150, 20.0, 6.0, 4.0, 220, ["Brocheta de pollo al microondas"], SOURCE_UDELAR),
    food("Buñuelos cantoneses", 205, 7.0, 10.0, 24.0, 120, ["Bunuelos cantoneses"], SOURCE_UDELAR),
    food("Chop suey con tallarines", 125, 7.0, 4.0, 16.0, 350, source=SOURCE_UDELAR),
    food("Croquetas de papa", 205, 5.0, 10.0, 25.0, 120, source=SOURCE_UDELAR),
    food("Fainá de zanahoria", 175, 7.0, 6.0, 25.0, 150, ["Faina de zanahoria"], SOURCE_UDELAR),
    food("Milanesa de zapallitos", 155, 5.0, 7.0, 19.0, 180, source=SOURCE_UDELAR),
    food("Ratatouille", 70, 1.5, 4.5, 7.0, 250, source=SOURCE_UDELAR),
    food("Tarta de zapallitos", 165, 7.0, 9.0, 15.0, 250, source=SOURCE_UDELAR),
    food("Torta de vegetales licuada", 155, 6.0, 8.0, 17.0, 180, source=SOURCE_UDELAR),
    food("Wrap de jamón", 235, 12.0, 11.0, 23.0, 180, ["Wraps de jamón", "Wrap de jamon"], SOURCE_UDELAR),
    food("Pizza exprés a la sartén", 245, 10.0, 9.0, 34.0, 180, ["Pizza express a la sartén"], SOURCE_UDELAR),
    food("Masa de empanadas con levadura", 285, 8.0, 8.0, 46.0, 100, source=SOURCE_UDELAR),
    food("Masa de empanadas con polvo de hornear", 300, 7.5, 10.0, 45.0, 100, source=SOURCE_UDELAR),
    food("Tallarines de espinaca", 145, 5.0, 1.5, 28.0, 250, source=SOURCE_UDELAR),
    food("Salsa boloñesa", 105, 7.0, 5.0, 8.0, 100, ["Salsa bolognesa"], SOURCE_UDELAR),
    food("Cazuela de lentejas y carne", 125, 8.0, 4.0, 15.0, 350, source=SOURCE_UDELAR),
    food("Cazuela vegetariana", 90, 4.0, 2.5, 14.0, 350, source=SOURCE_UDELAR),
    food("Sopa crema de puerro y cebolla", 65, 1.5, 3.5, 8.0, 300, source=SOURCE_UDELAR),
    food("Sopa crema de zapallo y arvejas", 70, 2.5, 2.5, 11.0, 300, source=SOURCE_UDELAR),
    food("Sopa crema de choclo", 85, 2.5, 3.0, 13.0, 300, source=SOURCE_UDELAR),
    food("Carne con salsa estofada", 145, 14.0, 7.0, 7.0, 300, source=SOURCE_UDELAR),
    food("Carne con salsa de cacerola", 150, 15.0, 7.0, 7.0, 300, ["Carne con salsa cacerola"], SOURCE_UDELAR),
    food("Carne con salsa portuguesa", 140, 14.0, 6.0, 8.0, 300, source=SOURCE_UDELAR),
    food("Hamburguesa casera", 220, 20.0, 14.0, 4.0, 120, ["Hamburguesas"], SOURCE_UDELAR),
    food("Hamburguesa de lentejas", 170, 8.0, 6.0, 22.0, 120, ["Hamburguesas de lentejas"], SOURCE_UDELAR),
    food("Polenta florentina", 105, 4.0, 4.0, 14.0, 300, source=SOURCE_UDELAR),
    food("Ñoquis de papa", 145, 4.0, 1.0, 31.0, 250, ["Noquis de papa"], SOURCE_UDELAR),
    food("Ñoquis de calabaza", 135, 4.0, 1.0, 28.0, 250, ["Noquis de calabaza"], SOURCE_UDELAR),
    food("Ñoquis de ricota y espinaca", 160, 8.0, 5.0, 22.0, 250, ["Noquis de ricota y espinaca"], SOURCE_UDELAR),
    food("Merluza a la plancha con salsa verde", 130, 20.0, 5.0, 2.0, 250, source=SOURCE_UDELAR),
    food("Pescado arrollado con salsa portuguesa", 125, 17.0, 4.0, 6.0, 280, source=SOURCE_UDELAR),
    food("Brownie de lentejas y cacao", 255, 7.0, 9.0, 38.0, 70, ["Brownies con lenteja y cacao"], SOURCE_UDELAR),
    food("Pan de zapallo", 260, 7.0, 5.0, 48.0, 70, source=SOURCE_UDELAR),
    food("Scones", 365, 8.0, 16.0, 49.0, 60, source=SOURCE_UDELAR),
    food("Torta de manzana al microondas", 230, 4.0, 7.0, 39.0, 100, source=SOURCE_UDELAR),
    food("Pan de banana", 305, 5.0, 11.0, 48.0, 80, source=SOURCE_UDELAR),
    food("Torta moka", 365, 5.5, 17.0, 49.0, 100, source=SOURCE_UDELAR),
    food("Torta de mandarina licuada", 310, 5.0, 12.0, 47.0, 100, ["Torta de mandarinas licuada"], SOURCE_UDELAR),
    food("Torta de zanahoria y naranja", 325, 5.0, 14.0, 46.0, 100, source=SOURCE_UDELAR),
    food("Bizcochuelo de naranja", 285, 6.0, 8.0, 48.0, 80, source=SOURCE_UDELAR),
    food("Galletas de aceite", 425, 7.0, 17.0, 62.0, 30, source=SOURCE_UDELAR),
    food("Tortugas integrales", 265, 10.0, 4.0, 48.0, 70, ["Pan tortuga integral"], SOURCE_UDELAR),
    food("Mermelada dietética de tomate y naranja", 60, 0.7, 0.1, 14.0, 20, ["Mermelada de tomate y naranja dietética"], SOURCE_UDELAR),
    food("Mermelada dietética de manzana", 55, 0.2, 0.1, 14.0, 20, ["Mermelada de manzana dietética"], SOURCE_UDELAR),
    food("Salsa blanca", 115, 3.5, 6.0, 12.0, 50, ["Salsa bechamel"], SOURCE_UDELAR),
    food("Crema de vainilla", 125, 3.0, 3.0, 22.0, 150, source=SOURCE_UDELAR),
    food("Bruschettas", 210, 6.0, 8.0, 29.0, 60, ["Bruschetta"], SOURCE_UDELAR),
    food("Cintas crocantes", 390, 8.0, 17.0, 52.0, 30, ["Carta musical", "Cintas crocantes de masa"], SOURCE_UDELAR),
    food("Baba ganoush", 110, 2.0, 8.0, 8.0, 50, ["Puré de berenjenas", "Baba Ganoush"], SOURCE_UDELAR),
    food("Palitos de queso", 350, 13.0, 20.0, 30.0, 40, source=SOURCE_UDELAR),
    food("Galletitas de sésamo", 450, 9.0, 22.0, 56.0, 25, ["Galletas de sésamo"], SOURCE_UDELAR),
    food("Cookies de avena y miel", 410, 7.0, 16.0, 61.0, 35, source=SOURCE_UDELAR),
    food("Galletas de jengibre", 405, 6.0, 13.0, 67.0, 25, source=SOURCE_UDELAR),
    food("Lomo Wellington", 275, 17.0, 17.0, 15.0, 250, ["Lomo a la Wellington"], SOURCE_UDELAR),
    food("Agua saborizada con frutas", 5, 0.0, 0.0, 1.2, 250, ["Aguas saborizadas"], SOURCE_UDELAR),
    food("Ananá asada con jengibre y miel", 105, 0.5, 0.2, 27.0, 180, ["Anana asada con jengibre y miel"], SOURCE_UDELAR),
    food("Crema de yogur con frutas de estación", 105, 4.0, 3.0, 16.0, 180, source=SOURCE_UDELAR),
    food("Frutillas maceradas con mascarpone", 185, 3.0, 13.0, 15.0, 160, ["Frutillas maceradas con cremoso de mascarpone"], SOURCE_UDELAR),
]


def find_default_input() -> Path:
    candidates = [
        Path("data/opennutrition-es-general-ampliado.json"),
        Path("data/opennutrition-es-general.json"),
        Path("opennutrition-es-general-ampliado.json"),
        Path("opennutrition-es-general.json"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(
        "No encontré el catálogo. Indicá la ruta como primer argumento, por ejemplo:\n"
        "python3 tools/agregar-alimentos-uruguayos-v2.py data/opennutrition-es-general-ampliado.json"
    )


def collect_keys(item: Dict[str, Any]) -> set[str]:
    values: Iterable[Any] = [item.get("name"), *(item.get("aliases") or [])]
    return {norm(value) for value in values if norm(value)}


def main() -> None:
    input_path = Path(sys.argv[1]) if len(sys.argv) >= 2 else find_default_input()
    output_path = Path(sys.argv[2]) if len(sys.argv) >= 3 else input_path

    if not input_path.exists():
        raise SystemExit(f"No existe el archivo: {input_path}")

    with input_path.open("r", encoding="utf-8-sig") as fh:
        catalog = json.load(fh)

    if not isinstance(catalog, list):
        raise SystemExit("El JSON debe contener una lista de alimentos.")

    known_keys: set[str] = set()
    known_ids: set[str] = set()
    for item in catalog:
        if isinstance(item, dict):
            known_keys.update(collect_keys(item))
            if item.get("id"):
                known_ids.add(str(item["id"]))

    added: List[str] = []
    skipped: List[str] = []

    for item in ADDITIONS:
        item_keys = collect_keys(item)
        if item_keys & known_keys or item["id"] in known_ids:
            skipped.append(item["name"])
            continue

        catalog.append(item)
        known_keys.update(item_keys)
        known_ids.add(item["id"])
        added.append(item["name"])

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.resolve() == input_path.resolve():
        backup = input_path.with_suffix(input_path.suffix + ".bak")
        if not backup.exists():
            shutil.copy2(input_path, backup)
            print(f"Copia de seguridad: {backup}")

    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(catalog, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"Archivo generado: {output_path}")
    print(f"Registros iniciales: {len(catalog) - len(added)}")
    print(f"Agregados: {len(added)}")
    print(f"Ya existentes/duplicados: {len(skipped)}")
    print(f"Registros finales: {len(catalog)}")

    if added:
        print("\nNuevos registros:")
        for name in added:
            print(f"  + {name}")


if __name__ == "__main__":
    main()
