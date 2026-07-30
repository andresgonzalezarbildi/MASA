#!/usr/bin/env python3
"""Aplica correcciones puntuales sobre la versión actual de M.A.S.A.

Modifica únicamente:
- index.html
- css/styles.css
- js/app.js

Cambios:
- corrige el ancho de Acerca de M.A.S.A. en móviles;
- cambia el rótulo del resumen a "Calorías consumidas";
- elimina la nota interna sobre cierre y lectura teórica;
- permite editar desde los resultados alimentos propios y recetas.
"""

import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

MARKER = "MASA_V29_MOBILE_ABOUT_SEARCH_EDIT_V1"


def fail(message):
    raise RuntimeError(message)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        fail("{}: se esperaba una coincidencia y se encontraron {}.".format(label, count))
    return text.replace(old, new, 1)


def patch_index(source):
    # Tolera tanto el texto corto actual como variantes anteriores más largas.
    if "<span>Calorías consumidas</span>" not in source:
        pattern = (
            r'(<div\s+class=["\']diary-total["\'][^>]*>\s*)'
            r'<span>\s*Consumidas(?:\s+en\s+la\s+fecha\s+seleccionad[ao]s?)?\s*</span>'
        )
        source, count = re.subn(
            pattern,
            r'\1<span>Calorías consumidas</span>',
            source,
            count=1,
            flags=re.IGNORECASE,
        )
        if count != 1:
            fail('index.html: no se encontró el rótulo "Consumidas" del resumen diario.')

    note_pattern = (
        r'\s*<p\s+class=["\']finish-day-note["\'][^>]*>\s*'
        r'El\s+cierre\s+y\s+la\s+lectura\s+te[oó]rica\s+quedan\s+asociados?\s+'
        r'a\s+la\s+fecha\s+seleccionada\.\s*</p>'
    )
    source, removed = re.subn(note_pattern, "", source, count=1, flags=re.IGNORECASE)
    if removed == 0 and "El cierre y la lectura teórica" in source:
        fail("index.html: se encontró la nota interna, pero no se pudo eliminar con seguridad.")

    return source


def patch_app(source):
    if MARKER not in source:
        origin_block = '''    const originBadge = item.kind === "food"
      ? `<span class="food-origin-badge food-origin-own">${item.source === "openfoodfacts" ? "Escaneado" : "Propio"}</span>`
      : item.kind === "external" && item.userOverride
        ? '<span class="food-origin-badge food-origin-edited">Editado</span>'
        : "";
'''
        edit_actions = origin_block + '''    // {}: edición directa desde búsqueda, recientes, frecuentes y recetas.
    const editActions = item.kind === "external"
      ? `<div class="food-catalog-actions"><button class="text-action" data-edit-catalog-food="${{escapeHTML(item.id)}}" type="button">Editar alimento</button><button class="danger-text-action" data-hide-catalog-food="${{escapeHTML(item.id)}}" type="button">Ocultar</button></div>`
      : item.kind === "recipe"
        ? `<div class="food-catalog-actions"><button class="text-action" data-edit-user-food="${{escapeHTML(item.id)}}" data-edit-user-kind="recipe" type="button">Editar receta</button></div>`
        : `<div class="food-catalog-actions"><button class="text-action" data-edit-user-food="${{escapeHTML(item.id)}}" data-edit-user-kind="food" type="button">Editar alimento</button></div>`;
'''.format(MARKER)
        source = replace_once(
            source,
            origin_block,
            edit_actions,
            "js/app.js: acciones de edición por tipo",
        )

        source = replace_once(
            source,
            '    form.className = `food-inline-add${item.kind === "external" ? " has-catalog-actions" : ""}`;\n',
            '    form.className = "food-inline-add has-catalog-actions";\n',
            "js/app.js: distribución de acciones del resultado",
        )

        old_actions = '      ${item.kind === "external" ? `<div class="food-catalog-actions"><button class="text-action" data-edit-catalog-food="${escapeHTML(item.id)}" type="button">Editar alimento</button><button class="danger-text-action" data-hide-catalog-food="${escapeHTML(item.id)}" type="button">Ocultar</button></div>` : ""}\n'
        source = replace_once(
            source,
            old_actions,
            '      ${editActions}\n',
            "js/app.js: render de acciones editables",
        )

        handler_anchor = '''  function handleFoodResultClick(event) {
    const editCatalog = event.target.closest("[data-edit-catalog-food]");
'''
        handler_replacement = '''  function handleFoodResultClick(event) {
    const editUserFood = event.target.closest("[data-edit-user-food]");
    if (editUserFood) {
      const options = { editId: editUserFood.dataset.editUserFood, returnTarget: "food" };
      if (editUserFood.dataset.editUserKind === "recipe") openRecipeEditor(options);
      else openFoodEditor(options);
      return;
    }
    const editCatalog = event.target.closest("[data-edit-catalog-food]");
'''
        source = replace_once(
            source,
            handler_anchor,
            handler_replacement,
            "js/app.js: evento de edición desde resultados",
        )

    required = [
        MARKER,
        "data-edit-user-food",
        'data-edit-user-kind="recipe"',
        "openRecipeEditor(options)",
        'form.className = "food-inline-add has-catalog-actions"',
    ]
    for value in required:
        if value not in source:
            fail("js/app.js: falta la validación final {}.".format(value))
    return source


def patch_css(source):
    if MARKER in source:
        return source

    addition = r'''

/* MASA_V29_MOBILE_ABOUT_SEARCH_EDIT_V1: ancho seguro de Acerca de en móvil */
#about-modal .about-sheet {
  width: min(
    780px,
    calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)))
  );
  max-width: calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)));
  overflow-x: hidden;
}
#about-modal .settings-header,
#about-modal .settings-header > div,
#about-modal .about-copy,
#about-modal .about-copy > *,
#about-modal .about-math,
#about-modal .about-formulas,
#about-modal .about-formulas article {
  min-width: 0;
  max-width: 100%;
}
#about-modal .about-formulas code,
#about-modal .about-reference,
#about-modal .about-reference a {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
#about-modal .about-formulas code {
  white-space: normal;
}
@media (max-width: 590px) {
  #about-modal .about-sheet {
    width: calc(100vw - max(8px, env(safe-area-inset-left)) - max(8px, env(safe-area-inset-right)));
    max-width: calc(100vw - max(8px, env(safe-area-inset-left)) - max(8px, env(safe-area-inset-right)));
    padding: 16px 12px;
    box-shadow: 5px 5px 0 var(--violet);
  }
  #about-modal .settings-header {
    align-items: flex-start;
    gap: 8px;
  }
  #about-modal .settings-header h2 {
    font-size: clamp(27px, 9vw, 36px);
    overflow-wrap: anywhere;
  }
  #about-modal .about-copy {
    margin-top: 14px;
    font-size: 13px;
    line-height: 1.5;
  }
  #about-modal .about-mission,
  #about-modal .about-math {
    padding: 12px 9px;
  }
  #about-modal .about-formulas article {
    padding: 10px 8px;
  }
}
'''
    return source.rstrip() + addition + "\n"


def node_check(path):
    node = shutil.which("node")
    if not node:
        return
    result = subprocess.run(
        [node, "--check", str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail("node --check falló para {}:\n{}".format(path, result.stderr))


def main():
    root = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    patchers = {
        root / "index.html": patch_index,
        root / "css" / "styles.css": patch_css,
        root / "js" / "app.js": patch_app,
    }

    missing = [str(path.relative_to(root)) for path in patchers if not path.exists()]
    if missing:
        fail("Faltan archivos de M.A.S.A.:\n- " + "\n- ".join(missing))

    originals = {}
    outputs = {}
    for path, patcher in patchers.items():
        originals[path] = path.read_text(encoding="utf-8")
        outputs[path] = patcher(originals[path])

    changed = [path for path in patchers if outputs[path] != originals[path]]
    if not changed:
        print("Estas correcciones ya estaban aplicadas; no se modificó ningún archivo.")
        return 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = root / ".masa-backups" / ("before-mobile-fixes-" + stamp)
    for path in changed:
        backup = backup_root / path.relative_to(root)
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)

    try:
        for path in changed:
            with path.open("w", encoding="utf-8", newline="\n") as handle:
                handle.write(outputs[path])
        node_check(root / "js" / "app.js")
    except Exception:
        for path in changed:
            shutil.copy2(backup_root / path.relative_to(root), path)
        raise

    print("Correcciones aplicadas.")
    print("Respaldo: {}".format(backup_root))
    print("Archivos modificados:")
    for path in changed:
        print("- {}".format(path.relative_to(root)))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print("ERROR: {}".format(error), file=sys.stderr)
        raise SystemExit(1)
