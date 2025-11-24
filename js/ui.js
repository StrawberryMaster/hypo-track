const UI = (() => {
    let suppresskeybinds = false;
    let categoryEditorModal;
    let refreshGUI;
    let zoomSliderEl;

    function init() {
        const uiContainer = document.getElementById('ui-container');
        if (!uiContainer) {
            console.error('UI container not found!');
            return;
        }

        // for the folder UI
        const style = document.createElement('style');
        style.textContent = `
            #season-browser { border: 1px solid #ccc; height: 150px; overflow-y: auto; background: #f9f9f9; margin: 5px 0; border-radius: 3px; }
            .browser-item { padding: 4px 8px; cursor: pointer; user-select: none; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 6px; font-size: 13px; }
            .browser-item:last-child { border-bottom: none; }
            .browser-item:hover { background: #e9e9e9; }
            .browser-item.selected { background: #a0c4ff; color: #000; font-weight: bold; }
            .folder-item::before { content: '📁'; }
            .season-item::before { content: '🌀'; }
            #browser-header { display: flex; align-items: center; margin-top: 1rem; gap: 5px; }
            #browser-path { font-weight: bold; color: #555; background: #eee; padding: 4px 8px; border-radius: 3px; flex-grow: 1; }
            #browser-back-btn { padding: 2px 8px; }
            #browser-actions { display: flex; gap: 5px; flex-wrap: wrap; }
            #browser-actions .btn { flex-grow: 1; }

            .dropdown-container {
                border: none;
                position: relative;
                flex: 1;
            }
            .dropdown-container .btn {
                width: 100%;
            }
            .dropdown-menu {
                display: none;
                position: absolute;
                bottom: 100%;
                left: 0;
                background-color: #f9f9f9;
                min-width: 100%;
                box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.2);
                z-index: 10;
                border-radius: 3px;
                border: 1px solid #ccc;
                padding: 4px 0;
                margin-bottom: 4px;
            }
            .dropdown-menu.show {
                display: block;
            }
            .dropdown-item {
                color: black;
                padding: 6px;
                text-decoration: none;
                display: block;
                width: 100%;
                text-align: left;
                border: none;
                background: none;
                cursor: pointer;
                font-size: 13px;
            }
            .dropdown-item:hover {
                background-color: #e9e9e9;
            }
        `;
        document.head.appendChild(style);

        // GUI //
        let categoryEditorModal;

        const mainFragment = document.createDocumentFragment();

        const createElement = (type, options = {}) => {
            const element = document.createElement(type);
            Object.assign(element, options);
            return element;
        };

        function createLabeledElement(id, labelText, element, fragment) {
            const label = createElement('label', { htmlFor: id, textContent: labelText });
            const br = createElement('br');
            fragment.append(label, element, br);
            return element;
        }

        const div = () => createElement('div');
        const dropdownOption = value => createElement('option', { value, textContent: value });

        function dropdown(id, label, data, fragment) {
            const select = createElement('select', { id });
            const options = Object.keys(data).map(key => createElement('option', { value: key, textContent: key }));
            select.append(...options);
            return createLabeledElement(id, label, select, fragment);
        }

        function button(label, fragment) {
            const btn = createElement('button', { textContent: label, className: 'btn' });
            fragment.append(btn, createElement('br'));
            return btn;
        }

        function checkbox(id, label, fragment) {
            const cb = createElement('input', { type: 'checkbox', id });
            return createLabeledElement(id, label, cb, fragment);
        }

        function textbox(id, label, fragment) {
            const input = createElement('input', { type: 'text', id });
            input.addEventListener('focus', () => suppresskeybinds = true, { passive: true });
            input.addEventListener('blur', () => suppresskeybinds = false, { passive: true });
            return createLabeledElement(id, label, input, fragment);
        }

        const undoredo = div();
        undoredo.id = "undo-redo";
        mainFragment.appendChild(undoredo);

        const undoButton = button('Undo', new DocumentFragment());
        undoButton.onclick = () => { History.undo(); refreshGUI(); };
        const redoButton = button('Redo', new DocumentFragment());
        redoButton.onclick = () => { History.redo(); refreshGUI(); };
        undoredo.append(undoButton, redoButton);

        const dropdowns = div();
        mainFragment.appendChild(dropdowns);
        const dropdownsFragment = new DocumentFragment();

        const categorySelect = createElement('select', { id: 'category-select' });
        createLabeledElement('category-select', 'Select category:', categorySelect, dropdownsFragment);
        categorySelect.onchange = () => AppState.setCategoryToPlace(parseInt(categorySelect.value, 10));

        const typeSelectData = { 'Tropical': 0, 'Subtropical': 1, 'Non-Tropical': 2 };
        const typeSelect = dropdown('type-select', 'Select type:', typeSelectData, dropdownsFragment);
        typeSelect.onchange = () => AppState.setTypeToPlace(typeSelectData[typeSelect.value]);
        dropdowns.appendChild(dropdownsFragment);

        const buttons = div();
        const buttonsFragment = new DocumentFragment();
        mainFragment.appendChild(buttons);

        const deselectButton = button('Deselect track', buttonsFragment);
        deselectButton.onclick = () => { Utils.deselectTrack(); refreshGUI(); };
        buttons.appendChild(buttonsFragment);

        const trackInfoContainer = div();
        trackInfoContainer.id = 'track-info-container';
        trackInfoContainer.style.display = 'none';
        const trackInfoFragment = new DocumentFragment();

        const trackNameInput = textbox('track-name-input', 'Storm name:', trackInfoFragment);
        const setTrackNameButton = button('Set name', trackInfoFragment);
        setTrackNameButton.onclick = () => {
            const selectedTrack = AppState.getSelectedTrack();
            if (selectedTrack) {
                const oldName = selectedTrack.name;
                const newName = document.getElementById('track-name-input').value.trim();
                if (oldName !== newName) {
                    History.record(History.ActionTypes.setTrackName, {
                        trackIndex: AppState.getTracks().indexOf(selectedTrack),
                        oldName, newName
                    });
                    selectedTrack.name = newName;
                    if (AppState.getAutosave()) Database.save();
                    Renderer.requestRedraw();
                }
            }
        };

        const trackDateContainer = div();
        trackDateContainer.id = 'track-date-container';
        const trackDateFragment = new DocumentFragment();
        const startDateInput = textbox('start-date-input', 'Start date (YYYYMMDD):', trackDateFragment);
        startDateInput.pattern = "\\d{8}";
        startDateInput.placeholder = "e.g. 20240825";
        const startTimeSelect = createElement('select', { id: 'start-time-select' });
        ['00', '06', '12', '18'].forEach(time => {
            const opt = createElement('option', { value: time, textContent: `${time}Z` });
            startTimeSelect.appendChild(opt);
        });
        createLabeledElement('start-time-select', 'Start time:', startTimeSelect, trackDateFragment);
        const setDateButton = button('Set date/time', trackDateFragment);
        setDateButton.onclick = () => {
            const selectedTrack = AppState.getSelectedTrack();
            if (selectedTrack && startDateInput.checkValidity()) {
                const oldStartDate = selectedTrack.startDate;
                const oldStartTime = selectedTrack.startTime;
                const newStartDate = startDateInput.value;
                const newStartTime = parseInt(startTimeSelect.value, 10);
                if (oldStartDate !== newStartDate || oldStartTime !== newStartTime) {
                    History.record(History.ActionTypes.setTrackDate, {
                        trackIndex: AppState.getTracks().indexOf(selectedTrack),
                        oldStartDate, oldStartTime,
                        newStartDate, newStartTime
                    });
                    selectedTrack.startDate = newStartDate;
                    selectedTrack.startTime = newStartTime;
                    if (AppState.getAutosave()) Database.save();
                    Renderer.requestRedraw();
                }
            } else {
                alert("Please enter a valid date in YYYYMMDD format.");
            }
        };
        trackDateContainer.appendChild(trackDateFragment);
        trackInfoFragment.appendChild(trackDateContainer);
        trackInfoContainer.appendChild(trackInfoFragment);
        buttons.appendChild(trackInfoContainer);

        const pointInfoContainer = div();
        pointInfoContainer.id = 'point-info-container';
        pointInfoContainer.style.display = 'none';
        const pointInfoFragment = new DocumentFragment();

        const windOverrideInput = textbox('wind-override-input', 'Wind (kt):', pointInfoFragment);
        windOverrideInput.type = 'number';
        windOverrideInput.min = '0';
        windOverrideInput.step = '5';
        const pressureOverrideInput = textbox('pressure-override-input', 'Pressure (mb):', pointInfoFragment);
        pressureOverrideInput.type = 'number';
        pressureOverrideInput.min = '800';
        pressureOverrideInput.max = '1050';

        const modifyTrackPointButton = button('Modify track point', pointInfoFragment);
        modifyTrackPointButton.onclick = () => {
            const selectedDot = AppState.getSelectedDot();
            if (!selectedDot) return;
            const oldCat = selectedDot.cat, oldType = selectedDot.type;
            const oldWind = selectedDot.wind, oldPressure = selectedDot.pressure;

            const newWindVal = document.getElementById('wind-override-input').value;
            const newPressureVal = document.getElementById('pressure-override-input').value;

            const newWind = newWindVal === '' ? null : parseInt(newWindVal, 10);
            const newPressure = newPressureVal === '' ? null : parseInt(newPressureVal, 10);

            selectedDot.cat = parseInt(categorySelect.value, 10);
            selectedDot.type = typeSelectData[typeSelect.value];
            selectedDot.wind = isNaN(newWind) ? null : newWind;
            selectedDot.pressure = isNaN(newPressure) ? null : newPressure;

            const selectedTrack = AppState.getSelectedTrack();
            History.record(History.ActionTypes.modifyPoint, {
                trackIndex: AppState.getTracks().indexOf(selectedTrack),
                pointIndex: selectedTrack.indexOf(selectedDot),
                oldCat, oldType, newCat: selectedDot.cat, newType: selectedDot.type,
                oldWind, oldPressure, newWind: selectedDot.wind, newPressure: selectedDot.pressure
            });
            if (AppState.getAutosave()) Database.save();
            Renderer.requestRedraw();
        };
        pointInfoContainer.appendChild(pointInfoFragment);
        buttons.appendChild(pointInfoContainer);

        const checkboxFragment = new DocumentFragment();
        const singleTrackCheckbox = checkbox('single-track-checkbox', 'Single track mode', checkboxFragment);
        singleTrackCheckbox.onchange = () => AppState.setHideNonSelectedTracks(singleTrackCheckbox.checked);
        const deletePointsCheckbox = checkbox('delete-points-checkbox', 'Delete track points', checkboxFragment);
        deletePointsCheckbox.onchange = () => AppState.setDeleteTrackPoints(deletePointsCheckbox.checked);
        const altColorCheckbox = checkbox('alt-color-checkbox', 'Use accessible colors', checkboxFragment);
        altColorCheckbox.onchange = () => AppState.setUseAltColors(altColorCheckbox.checked);
        const autosaveCheckbox = checkbox('autosave-checkbox', 'Autosave', checkboxFragment);
        autosaveCheckbox.checked = true;
        autosaveCheckbox.onchange = () => AppState.setAutosave(autosaveCheckbox.checked);
        buttons.appendChild(checkboxFragment);

        const dotSizeContainer = div();
        dotSizeContainer.id = 'dot-size-container';
        dotSizeContainer.style.border = 'none';
        dotSizeContainer.style.padding = '0';
        dotSizeContainer.style.margin = '0';
        const dotSizeSelect = createElement('select', { id: 'dot-size-select' });
        const dotSizeOptions = {
            'Tiny': 0.6, 'Small': 0.8, 'Normal': 1.0, 'Large': 1.5, 'X-Large': 2.0, 'Custom...': -1
        };
        for (const [text, value] of Object.entries(dotSizeOptions)) {
            const opt = createElement('option', { textContent: text, value: value });
            if (value === 1.0) opt.selected = true;
            dotSizeSelect.appendChild(opt);
        }

        let lastValidDotSize = AppState.getDotSizeMultiplier();
        dotSizeSelect.onchange = () => {
            const selectedValue = parseFloat(dotSizeSelect.value);
            if (selectedValue === -1) { // "Custom..." is selected
                const customValueStr = prompt('Enter custom dot size multiplier (e.g., 0.5 to 5.0):', lastValidDotSize);
                if (customValueStr !== null) {
                    const customValue = parseFloat(customValueStr);
                    if (!isNaN(customValue) && customValue >= 0.1 && customValue <= 5.0) {
                        AppState.setDotSizeMultiplier(customValue);
                        lastValidDotSize = customValue;
                    } else {
                        alert('Invalid size. Please enter a number between 0.1 and 5.0.');
                        dotSizeSelect.value = lastValidDotSize;
                    }
                } else {
                    dotSizeSelect.value = lastValidDotSize;
                }
            } else {
                AppState.setDotSizeMultiplier(selectedValue);
                lastValidDotSize = selectedValue;
            }
            Renderer.requestRedraw();
        };

        createLabeledElement('dot-size-select', 'Dot size:', dotSizeSelect, dotSizeContainer);
        buttons.appendChild(dotSizeContainer);

        // Save/Load UI //
        const saveloadContainer = div();
        saveloadContainer.id = 'saveload-container';
        mainFragment.appendChild(saveloadContainer);

        const saveloadTitle = createElement('h3', { textContent: 'Season management' });
        saveloadTitle.style.cssText = 'margin: 0 0 .5rem 0;';
        saveloadContainer.appendChild(saveloadTitle);

        const saveControls = div();
        const saveNameTextbox = textbox('save-name-textbox', 'Season name:', saveControls);
        saveNameTextbox.maxLength = 32;
        const saveButton = button('Save current', saveControls);
        saveloadContainer.appendChild(saveControls);

        const browserHeader = div();
        browserHeader.id = 'browser-header';
        const backButton = button('..', new DocumentFragment());
        backButton.id = 'browser-back-btn';
        const browserPathSpan = createElement('span', { id: 'browser-path' });
        browserHeader.append(backButton, browserPathSpan);
        saveloadContainer.appendChild(browserHeader);

        const seasonBrowserDiv = div();
        seasonBrowserDiv.id = 'season-browser';
        saveloadContainer.appendChild(seasonBrowserDiv);

        const browserActions = div();
        browserActions.id = 'browser-actions';
        const newFolderButton = button('New folder', new DocumentFragment());
        const moveSelectionButton = button('Move to...', new DocumentFragment());
        const deleteSelectionButton = button('Delete', new DocumentFragment());
        const newSeasonButton = button('New season', new DocumentFragment());
        browserActions.append(newFolderButton, moveSelectionButton, deleteSelectionButton, newSeasonButton);
        saveloadContainer.appendChild(browserActions);

        // Custom Category Management UI //
        const catManagementContainer = div();
        catManagementContainer.id = "cat-management-container";
        mainFragment.appendChild(catManagementContainer);

        const catManagementTitle = createElement('h3', { textContent: 'Custom categories' });
        catManagementTitle.style.margin = '.2rem 0 .5rem 0';
        catManagementContainer.appendChild(catManagementTitle);
        const catManagementFragment = new DocumentFragment();
        const addCategoryButton = button('Add new category', catManagementFragment);
        addCategoryButton.onclick = () => openCategoryEditor(null);
        const customCategoryListDiv = div();
        customCategoryListDiv.id = 'custom-category-list';
        catManagementFragment.append(customCategoryListDiv);
        catManagementContainer.appendChild(catManagementFragment);


        // Custom maps UI //
        const mapsContainer = div();
        mapsContainer.id = "maps-container";
        mainFragment.appendChild(mapsContainer);

        const mapsTitle = createElement('h3', { textContent: 'Custom maps' });
        mapsTitle.style.margin = '.2rem 0 .5rem 0';
        mapsContainer.appendChild(mapsTitle);

        const mapsFragment = new DocumentFragment();
        const customMapCheckbox = checkbox('use-custom-map-checkbox', 'Use custom map', mapsFragment);
        customMapCheckbox.onchange = () => {
            AppState.setUseCustomMap(customMapCheckbox.checked);
            Renderer.loadImages().then(() => {
                AppState.setLoadedMapImg(true);
                Renderer.requestRedraw();
            }).catch(err => console.error('Zoinks! Failed to load images:', err));
        };

        const mapDropdown = createElement('select', { id: 'custom-map-dropdown' });
        createLabeledElement('custom-map-dropdown', 'Select map:', mapDropdown, mapsFragment);
        mapDropdown.onchange = () => {
            if (mapDropdown.value) {
                AppState.setCurrentMapName(mapDropdown.value);
                if (AppState.getUseCustomMap()) {
                    Renderer.loadImages().then(() => {
                        AppState.setLoadedMapImg(true);
                        Renderer.requestRedraw();
                    }).catch(err => console.error('Yikes! Failed to load images:', err));
                }
            }
        };

        const uploadMapButton = button('Upload new map', mapsFragment);
        const mapUploaderDiv = div();
        mapUploaderDiv.id = 'map-uploader';
        mapUploaderDiv.style.cssText = 'display: none; border: 1px solid #ccc; padding: 10px; margin-top: 10px; border-radius: 4px; background: #f9f9f9;';

        const uploaderContent = `
            <label for="new-map-name">Map name:</label>
            <input type="text" id="new-map-name" placeholder="4-32 chars: a-z, 0-9, _, -">
            <span id="map-name-error" style="color: red; font-size: 12px; display: block;"></span>
            <input type="file" id="new-map-file" accept="image/*" style="margin-top: 8px;">
            <div style="margin-top: 10px;">
                <button id="save-new-map-btn" class="btn">Save</button>
                <button id="cancel-new-map-btn" class="btn">Cancel</button>
            </div>
        `;
        mapUploaderDiv.innerHTML = uploaderContent;
        mapsFragment.appendChild(mapUploaderDiv);

        const deleteMapButton = button('Delete map', mapsFragment);
        deleteMapButton.onclick = async () => {
            const currentMapName = AppState.getCurrentMapName();
            if (currentMapName === 'Default') {
                alert('One does not simply delete the default map.');
                return;
            }

            if (confirm(`You sure you want to delete the map "${currentMapName}"?`)) {
                try {
                    await Database.deleteMap(currentMapName);
                    alert(`Map "${currentMapName}" deleted successfully. Aaand it's gone.`);

                    customMapImg = null;
                    AppState.setCurrentMapName('Default');
                    AppState.setUseCustomMap(false);
                    customMapCheckbox.checked = false;

                    await refreshMapDropdown();
                    await Renderer.loadImages();
                    AppState.setLoadedMapImg(true);
                    Renderer.requestRedraw();
                } catch (error) {
                    alert(`Well, this is awkward. Error deleting map: ${error.message}`);
                    console.error('Delete map error:', error);
                }
            }
        };


        mapsContainer.appendChild(mapsFragment);

        // Export/Import UI //
        const exportContainer = div();
        exportContainer.id = "export-container";
        mainFragment.appendChild(exportContainer);

        const exportButtons = div();
        exportButtons.id = "export-buttons";
        exportButtons.style.display = 'flex';
        exportButtons.style.gap = '5px';
        exportContainer.appendChild(exportButtons);

        const decimalPlacesDiv = div();
        decimalPlacesDiv.style.cssText = 'border: none; margin: 0; padding: .1rem .2rem';
        const decimalPlacesLabel = createElement('label', { htmlFor: 'decimal-places-dropdown', textContent: 'Decimal places (lat/lon): ' });
        const decimalPlacesDropdown = createElement('select', { id: 'decimal-places-dropdown' });
        [0, 1, 2, 3, 4, 5].forEach(n => {
            const opt = createElement('option', { value: n, textContent: n });
            if (n === 1) opt.selected = true;
            decimalPlacesDropdown.appendChild(opt);
        });
        decimalPlacesDiv.append(decimalPlacesLabel, decimalPlacesDropdown);
        exportContainer.appendChild(decimalPlacesDiv);

        // helper for creating standard buttons
        const createStandardButton = (text, action) => {
            const btn = button(text, new DocumentFragment());
            btn.classList.add("btn");
            btn.onclick = action;
            exportButtons.appendChild(btn);
            return btn;
        };

        // helper for creating dropdown buttons
        function createDropdownButton(label, options) {
            const container = createElement('div', { className: 'dropdown-container' });
            const mainButton = createElement('button', { textContent: label, className: 'btn dropdown-toggle' });
            const menu = createElement('div', { className: 'dropdown-menu' });

            options.forEach(opt => {
                const item = createElement('button', { textContent: opt.label, className: 'dropdown-item' });
                item.onclick = (e) => {
                    opt.action(e);
                    menu.classList.remove('show');
                };
                menu.appendChild(item);
            });

            mainButton.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.dropdown-menu.show').forEach(openMenu => {
                    if (openMenu !== menu) openMenu.classList.remove('show');
                });
                menu.classList.toggle('show');
            };

            container.append(mainButton, menu);
            return container;
        }

        window.addEventListener('click', (e) => {
            if (!e.target.matches('.dropdown-toggle')) {
                document.querySelectorAll('.dropdown-menu.show').forEach(openMenu => {
                    openMenu.classList.remove('show');
                });
            }
        });

        // --- create buttons ---
        createStandardButton('Download image', () => {
            const canvas = AppState.getCanvas();
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `hypo-track-${timestamp}.png`;
            canvas.toBlob(blob => {
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
            }, 'image/png');
        });

        const importExportSubContainer = div();
        importExportSubContainer.style.display = 'flex';
        importExportSubContainer.style.gap = '5px';
        importExportSubContainer.style.flexGrow = '1';

        const exportDropdown = createDropdownButton('Export', [
            {
                label: 'HURDAT',
                action: () => {
                    const decimalPlaces = parseInt(decimalPlacesDropdown.value, 10);
                    const hurdat = ImportExport.exportHURDAT(decimalPlaces);
                    const blob = new Blob([hurdat], { type: 'text/plain' });
                    const link = document.createElement('a');
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                    link.download = `hypo-track-hurdat-${timestamp}.txt`;
                    link.href = URL.createObjectURL(blob);
                    link.click();
                    URL.revokeObjectURL(link.href);
                }
            },
            {
                label: 'JSON',
                action: () => {
                    const compressJson = document.getElementById('compress-json-checkbox').checked;
                    const decimalPlaces = parseInt(decimalPlacesDropdown.value, 10);
                    const json = ImportExport.exportJSON(decimalPlaces);
                    const jsonString = compressJson ? JSON.stringify(json) : JSON.stringify(json, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const link = document.createElement('a');
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                    link.download = `hypo-track-json-${timestamp}.json`;
                    link.href = URL.createObjectURL(blob);
                    link.click();
                    URL.revokeObjectURL(link.href);
                }
            }
        ]);
        importExportSubContainer.appendChild(exportDropdown);

        const importDropdown = createDropdownButton('Import', [
            {
                label: 'HURDAT',
                action: () => {
                    const fileInput = createElement('input', { type: 'file', accept: '.txt,text/plain' });
                    fileInput.style.display = 'none';
                    fileInput.onchange = () => {
                        if (fileInput.files.length > 0) {
                            ImportExport.importHURDATFile(fileInput.files[0]);
                            fileInput.value = "";
                        }
                    };
                    document.body.appendChild(fileInput);
                    fileInput.click();
                    document.body.removeChild(fileInput);
                }
            },
            {
                label: 'JSON',
                action: () => {
                    const fileInput = createElement('input', { type: 'file', accept: '.json,application/json' });
                    fileInput.style.display = 'none';
                    fileInput.onchange = () => {
                        if (fileInput.files.length > 0) {
                            ImportExport.importJSONFile(fileInput.files[0]);
                            fileInput.value = ""; // reset input after processing
                        }
                    };
                    document.body.appendChild(fileInput);
                    fileInput.click();
                    document.body.removeChild(fileInput);
                }
            }
        ]);
        importExportSubContainer.appendChild(importDropdown);

        exportButtons.appendChild(importExportSubContainer);

        // JSON compression options
        const jsonOptionsDiv = div();
        jsonOptionsDiv.style.cssText = 'border: none; padding: .2rem 0 0 0; margin-bottom: 0;';
        exportContainer.appendChild(jsonOptionsDiv);
        jsonOptionsDiv.append(
            createElement('input', { type: 'checkbox', id: 'compress-json-checkbox' }),
            createElement('label', { htmlFor: 'compress-json-checkbox', textContent: 'Compress JSON', title: 'Minimizes the size of the JSON file by removing unnecessary whitespace. May make the file harder to read, but reduces file size by up to 60%.' }),
            createElement('br'),
            createElement('input', { type: 'checkbox', id: 'compatibility-mode-checkbox' }),
            createElement('label', { htmlFor: 'compatibility-mode-checkbox', textContent: 'Compatibility mode', title: 'Adds missing fields to the HURDAT format. Only applies to HURDAT exports, and necessary for some parsers (like GoldStandardBot).' })
        );

        // --- Folder management logic ---
        const SAVE_NAME_REGEX = /^[a-zA-Z0-9 _\-]{4,32}$/;

        function clearBrowserSelection() {
            document.querySelectorAll('.browser-item.selected').forEach(el => el.classList.remove('selected'));
            AppState.getSelectedBrowserItems().clear();
            updateBrowserActionButtons();
        }

        function updateBrowserActionButtons() {
            const hasSelection = AppState.getSelectedBrowserItems().size > 0;
            moveSelectionButton.disabled = !hasSelection;
            deleteSelectionButton.disabled = !hasSelection;
        }

        async function refreshSeasonBrowser() {
            const allSaves = await Database.list();
            const folders = await Database.loadFolders();

            const browserDiv = document.getElementById('season-browser');
            browserDiv.innerHTML = '';

            const assignedSaves = new Set(folders.flatMap(f => f.seasons));
            let itemsToShow = [];

            const currentView = AppState.getCurrentView();
            if (currentView.type === 'root') {
                const unassignedSaves = allSaves.filter(s => !assignedSaves.has(s));
                const folderItems = folders.map(f => ({ type: 'folder', name: f.name }));
                const seasonItems = unassignedSaves.map(s => ({ type: 'season', name: s }));
                itemsToShow = [...folderItems, ...seasonItems];
                browserPathSpan.textContent = 'All seasons';
                backButton.disabled = true;
            } else { // 'folder' view
                const folder = folders.find(f => f.name === currentView.name);
                if (folder) {
                    itemsToShow = folder.seasons
                        .filter(sName => allSaves.includes(sName)) // ensure season exists
                        .map(s => ({ type: 'season', name: s }));
                    browserPathSpan.textContent = `📁 ${currentView.name}`;
                }
                backButton.disabled = false;
            }

            itemsToShow.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach(item => {
                const itemDiv = createElement('div', {
                    className: `browser-item ${item.type}-item`,
                    textContent: item.name,
                });
                itemDiv.dataset.name = item.name;
                itemDiv.dataset.type = item.type;
                if (AppState.getSaveName() && item.name === AppState.getSaveName()) itemDiv.classList.add('selected');

                itemDiv.addEventListener('click', (e) => {
                    const itemName = item.name;
                    const selectedBrowserItems = AppState.getSelectedBrowserItems();
                    if (!e.ctrlKey && !e.metaKey) {
                        clearBrowserSelection();
                    }
                    if (selectedBrowserItems.has(itemName)) {
                        selectedBrowserItems.delete(itemName);
                        itemDiv.classList.remove('selected');
                    } else {
                        selectedBrowserItems.add(itemName);
                        itemDiv.classList.add('selected');
                    }
                    updateBrowserActionButtons();
                });

                itemDiv.addEventListener('dblclick', () => {
                    if (item.type === 'folder') {
                        AppState.setCurrentView({ type: 'folder', name: item.name });
                        clearBrowserSelection();
                        refreshSeasonBrowser();
                    } else if (item.type === 'season') {
                        if (AppState.getSaveLoadReady()) {
                            AppState.setSaveName(item.name);
                            Database.load().then(() => {
                                Utils.deselectTrack();
                                History.reset();
                                refreshGUI();
                            });
                        }
                    }
                });
                browserDiv.appendChild(itemDiv);
            });
            updateBrowserActionButtons();
        }

        backButton.onclick = () => {
            const currentView = AppState.getCurrentView();
            if (currentView.type === 'folder') {
                AppState.setCurrentView({ type: 'root' });
                clearBrowserSelection();
                refreshSeasonBrowser();
            }
        };

        saveButton.onclick = () => {
            if (SAVE_NAME_REGEX.test(saveNameTextbox.value)) {
                AppState.setSaveName(saveNameTextbox.value);
                Database.save().then(refreshSeasonBrowser);
            } else alert('Save names must be 4-32 characters long and only contain letters, numbers, spaces, underscores, or hyphens.');
        };

        newSeasonButton.onclick = () => {
            AppState.setTracks([]);
            AppState.setSaveName(undefined);
            Utils.deselectTrack();
            History.reset();
            refreshGUI();
        };

        newFolderButton.onclick = async () => {
            const folderName = prompt("Enter new folder name (4-32 characters):");
            if (folderName && SAVE_NAME_REGEX.test(folderName)) {
                const folders = await Database.loadFolders();
                if (folders.some(f => f.name === folderName)) {
                    alert('A folder with this name already exists.');
                    return;
                }
                await Database.saveFolders([...folders, { name: folderName, seasons: [] }]);
                refreshSeasonBrowser();
            } else if (folderName) {
                alert('Invalid folder name. Please use 4-32 characters (letters, numbers, spaces, _, -).');
            }
        };

        deleteSelectionButton.onclick = async () => {
            const selectedBrowserItems = AppState.getSelectedBrowserItems();
            if (selectedBrowserItems.size === 0) return;
            if (!confirm(`Are you sure you want to delete ${selectedBrowserItems.size} selected item(s)? This cannot be undone.`)) return;

            let foldersToDelete = [];
            let seasonsToDelete = [];

            selectedBrowserItems.forEach(name => {
                const itemEl = document.querySelector(`.browser-item[data-name="${name}"]`);
                if (itemEl.dataset.type === 'folder') foldersToDelete.push(name);
                else seasonsToDelete.push(name);
            });

            const folders = await Database.loadFolders();
            // delete folders (only if empty for simplicity)
            for (const folderName of foldersToDelete) {
                const folder = folders.find(f => f.name === folderName);
                if (folder && folder.seasons.length > 0) {
                    alert(`Folder "${folderName}" is not empty. Please move or delete its seasons first.`);
                    continue;
                }
                await Database.deleteFolder(folderName);
            }

            // delete seasons
            for (const seasonName of seasonsToDelete) {
                await Database.delete(seasonName);
                // remove from any folder it might be in
                folders.forEach(f => {
                    const index = f.seasons.indexOf(seasonName);
                    if (index > -1) f.seasons.splice(index, 1);
                });
            }
            await Database.saveFolders(folders);

            clearBrowserSelection();
            refreshSeasonBrowser();
        };

        moveSelectionButton.onclick = async () => {
            const selectedBrowserItems = AppState.getSelectedBrowserItems();
            if (selectedBrowserItems.size === 0) return;

            const folders = await Database.loadFolders();
            const currentView = AppState.getCurrentView();
            const targetableFolders = folders.filter(f => currentView.type === 'root' || f.name !== currentView.name);
            if (targetableFolders.length === 0) {
                alert("No other folders to move to. Create a new folder first.");
                return;
            }

            const destination = prompt("Move selection to folder:\n" + targetableFolders.map(f => `- ${f.name}`).join('\n'));
            if (!destination) return;

            const destFolder = folders.find(f => f.name.toLowerCase() === destination.toLowerCase());
            if (!destFolder) {
                alert(`Folder "${destination}" not found.`);
                return;
            }

            const itemsToMove = [...selectedBrowserItems].filter(name => {
                const el = document.querySelector(`.browser-item[data-name="${name}"]`);
                return el && el.dataset.type === 'season';
            });

            if ([...selectedBrowserItems].some(name => document.querySelector(`.browser-item[data-name="${name}"]`).dataset.type === 'folder')) {
                alert("Moving folders is not yet supported. Please select only seasons to move.");
                return;
            }

            // remove from old folders
            folders.forEach(f => {
                f.seasons = f.seasons.filter(s => !itemsToMove.includes(s));
            });

            // add to new folder
            itemsToMove.forEach(itemName => {
                if (!destFolder.seasons.includes(itemName)) {
                    destFolder.seasons.push(itemName);
                }
            });

            await Database.saveFolders(folders);
            clearBrowserSelection();
            refreshSeasonBrowser();
        };

        async function refreshMapDropdown() {
            try {
                const mapList = await Database.listMaps();
                const uniqueMaps = [...new Set(mapList)];
                const options = ['Default', ...uniqueMaps];

                const dropdownFragment = new DocumentFragment();
                options.forEach(item => dropdownFragment.appendChild(dropdownOption(item)));

                mapDropdown.replaceChildren(dropdownFragment);

                // ensure the selected value is still valid
                if (options.includes(AppState.getCurrentMapName())) {
                    mapDropdown.value = AppState.getCurrentMapName();
                } else {
                    AppState.setCurrentMapName('Default');
                    mapDropdown.value = 'Default';
                }
            } catch (error) {
                console.error('Jinkies! Failed to refresh map dropdown:', error);
                mapDropdown.replaceChildren(dropdownOption('Default'));
                mapDropdown.value = 'Default';
            }
        }

        function refreshCategoryDropdown() {
            const selectedValue = categorySelect.value;
            categorySelect.innerHTML = '';
            const masterCategories = AppState.getMasterCategories();
            masterCategories.forEach((cat, index) => {
                const opt = createElement('option', { value: index, textContent: cat.name });
                categorySelect.appendChild(opt);
            });
            categorySelect.value = masterCategories.some((c, i) => i == selectedValue) ? selectedValue : AppState.getCategoryToPlace();
        }

        function refreshCustomCategoryList() {
            const listDiv = document.getElementById('custom-category-list');
            if (!listDiv) return;
            listDiv.innerHTML = '';

            const customCategories = AppState.getCustomCategories();
            customCategories.forEach(cat => {
                const catDiv = div();
                catDiv.className = 'custom-cat-item';
                catDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 4px; border-left: 5px solid ${cat.color}; margin-bottom: 2px; background: #eee; border-radius: 3px;`;

                const nameSpan = createElement('span', { textContent: `${cat.name} (${cat.speed}kt, ${cat.pressure}mb)` });

                const buttonsDiv = div();
                const editBtn = createElement('button', { textContent: 'Edit', className: 'btn-small' });
                editBtn.onclick = () => openCategoryEditor(cat);
                const deleteBtn = createElement('button', { textContent: 'Del', className: 'btn-small' });
                deleteBtn.onclick = () => deleteCustomCategory(cat.name);

                buttonsDiv.append(editBtn, deleteBtn);
                catDiv.append(nameSpan, buttonsDiv);
                listDiv.appendChild(catDiv);
            });
        }

        refreshGUI = () => {
            undoButton.disabled = !History.canUndo();
            redoButton.disabled = !History.canRedo();

            refreshCategoryDropdown();
            refreshCustomCategoryList();
            refreshSeasonBrowser();

            categorySelect.value = AppState.getCategoryToPlace();
            typeSelect.value = Object.keys(typeSelectData).find(k => typeSelectData[k] === AppState.getTypeToPlace());

            singleTrackCheckbox.checked = AppState.getHideNonSelectedTracks();
            singleTrackCheckbox.disabled = deselectButton.disabled = !AppState.getSelectedTrack();

            const selectedTrack = AppState.getSelectedTrack();
            if (selectedTrack) {
                trackInfoContainer.style.display = 'block';
                trackNameInput.value = selectedTrack.name || '';
                startDateInput.value = selectedTrack.startDate || '';
                startTimeSelect.value = selectedTrack.startTime !== undefined ? Utils.padNumber(selectedTrack.startTime, 2) : '00';
            } else {
                trackInfoContainer.style.display = 'none';
            }

            const selectedDot = AppState.getSelectedDot();
            if (selectedDot) {
                pointInfoContainer.style.display = 'block';
                windOverrideInput.value = selectedDot.wind ?? '';
                pressureOverrideInput.value = selectedDot.pressure ?? '';
                windOverrideInput.placeholder = `e.g. ${AppState.getMasterCategories()[selectedDot.cat]?.speed || 'N/A'}`;
                pressureOverrideInput.placeholder = `e.g.: ${AppState.getMasterCategories()[selectedDot.cat]?.pressure || 'N/A'}`;
            } else {
                pointInfoContainer.style.display = 'none';
            }

            deletePointsCheckbox.checked = AppState.getDeleteTrackPoints();
            modifyTrackPointButton.disabled = !AppState.getSelectedDot() || !AppState.getSaveLoadReady();
            altColorCheckbox.checked = AppState.getUseAltColors();

            const currentMultiplier = AppState.getDotSizeMultiplier();
            const isPredefined = Object.values(dotSizeOptions).includes(currentMultiplier);
            dotSizeSelect.value = isPredefined ? currentMultiplier : -1;

            autosaveCheckbox.checked = AppState.getAutosave();
            saveButton.disabled = newSeasonButton.disabled = !AppState.getSaveLoadReady();
            saveNameTextbox.value = AppState.getSaveName() || '';

            refreshMapDropdown();
            Utils.updateCoordinatesDisplay();
            // keep zoom slider in sync
            if (zoomSliderEl) zoomSliderEl.value = String(AppState.getZoomAmt());
            Renderer.requestRedraw();
        };

        uiContainer.appendChild(mainFragment);

        uploadMapButton.onclick = () => {
            mapUploaderDiv.style.display = mapUploaderDiv.style.display === 'none' ? 'block' : 'none';
            document.getElementById('map-name-error').textContent = '';
        };

        const mapNameInput = document.getElementById('new-map-name');
        mapNameInput.addEventListener('focus', () => suppresskeybinds = true, { passive: true });
        mapNameInput.addEventListener('blur', () => suppresskeybinds = false, { passive: true });

        document.getElementById('cancel-new-map-btn').onclick = () => {
            mapUploaderDiv.style.display = 'none';
        };

        document.getElementById('save-new-map-btn').onclick = async () => {
            const nameInput = document.getElementById('new-map-name');
            const fileInput = document.getElementById('new-map-file');
            const errorSpan = document.getElementById('map-name-error');
            const mapName = nameInput.value.trim();
            const file = fileInput.files[0];

            errorSpan.textContent = '';

            const MAP_NAME_REGEX = /^[a-zA-Z0-9 _\-]{4,32}$/;
            if (!MAP_NAME_REGEX.test(mapName)) {
                errorSpan.textContent = 'Invalid name. Use 4-32 letters, numbers, spaces, _, or -.';
                return;
            }
            if (!file) {
                errorSpan.textContent = 'Please select a file.';
                return;
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                await Database.saveMap(mapName, new Uint8Array(arrayBuffer));

                mapUploaderDiv.style.display = 'none';
                nameInput.value = '';
                fileInput.value = '';

                await refreshMapDropdown();
                AppState.setCurrentMapName(mapName);
                mapDropdown.value = mapName;
                AppState.setUseCustomMap(true);
                customMapCheckbox.checked = true;

                Renderer.loadImages().then(() => {
                    AppState.setLoadedMapImg(true);
                    Renderer.requestRedraw();
                });

            } catch (error) {
                console.error("Jinkies! Error saving map:", error);
                errorSpan.textContent = `Jinkies! ${error.message}. Check console.`;
            }
        };

        // --- Category Editor Modal Logic ---
        function createCategoryEditorModal() {
            const modal = createElement('div', { id: 'category-editor-modal' });
            modal.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; display: none; align-items: center; justify-content: center;`;
            const form = createElement('form');
            form.style.cssText = `background: #f0f0f0; color: #333; padding: 20px; border-radius: 5px; width: 320px; box-shadow: 0 5px 15px rgba(0,0,0,0.3);`;
            form.innerHTML = `
                <h4 id="category-editor-title" style="margin-top: 0;">Edit Category</h4>
                <input type="hidden" id="category-editor-original-name">
                <label style="display:block; margin-bottom: 8px;">Name: <input type="text" id="category-editor-name" required pattern="[a-zA-Z0-9 _\\-]{1,20}" style="width: 100%;"></label>
                <label style="display:block; margin-bottom: 8px;">Color: <input type="color" id="category-editor-color" value="#ffffff"></label>
                <label style="display:block; margin-bottom: 8px;">Alt color (optional): <input type="color" id="category-editor-alt-color" value="#ffffff"></label>
                <label style="display:block; margin-bottom: 8px;">Min. speed (kt): <input type="number" id="category-editor-speed" required min="0" step="1" style="width: 100%;"></label>
                <label style="display:block; margin-bottom: 15px;">Av. pressure (mb): <input type="number" id="category-editor-pressure" required min="800" max="1050" style="width: 100%;"></label>
                <button type="submit" id="category-editor-save" class="btn">Save</button>
                <button type="button" id="category-editor-cancel" class="btn">Cancel</button>
            `;
            modal.appendChild(form);
            document.body.appendChild(modal);

            form.onsubmit = async (e) => {
                e.preventDefault();
                const originalName = document.getElementById('category-editor-original-name').value;
                const newCategory = {
                    name: document.getElementById('category-editor-name').value.trim(),
                    color: document.getElementById('category-editor-color').value,
                    altColor: document.getElementById('category-editor-alt-color').value,
                    speed: parseInt(document.getElementById('category-editor-speed').value, 10),
                    pressure: parseInt(document.getElementById('category-editor-pressure').value, 10)
                };

                if (newCategory.name !== originalName && AppState.getMasterCategories().some(c => c.name === newCategory.name)) {
                    alert("A category with this name already exists.");
                    return;
                }

                if (originalName) {
                    const customCategories = AppState.getCustomCategories();
                    const index = customCategories.findIndex(c => c.name === originalName);
                    if (index > -1) {
                        if (originalName !== newCategory.name) {
                            await Database.deleteCategory(originalName);
                        }
                        customCategories[index] = newCategory;
                    }
                } else {
                    const customCategories = AppState.getCustomCategories();
                    customCategories.push(newCategory);
                }

                await Database.saveCategories(AppState.getCustomCategories());
                Utils.regenerateMasterCategories();
                modal.style.display = 'none';
                Renderer.requestRedraw();
            };
            document.getElementById('category-editor-cancel').onclick = () => {
                modal.style.display = 'none';
            };
            return modal;
        }

        async function deleteCustomCategory(categoryName) {
            const masterCategories = AppState.getMasterCategories();
            const catIndexInMaster = masterCategories.findIndex(c => c.name === categoryName);
            if (catIndexInMaster === -1) return;

            const tracks = AppState.getTracks();
            const isInUse = tracks.some(track => track.some(point => point.cat === catIndexInMaster));
            if (isInUse) {
                alert(`Cannot delete category "${categoryName}" because it is currently in use by one or more track points.`);
                return;
            }

            if (confirm(`Are you sure you want to delete the category "${categoryName}"? This cannot be undone.`)) {
                const customCategories = AppState.getCustomCategories();
                const filtered = customCategories.filter(c => c.name !== categoryName);
                AppState.setCustomCategories(filtered);
                await Database.deleteCategory(categoryName);
                Utils.regenerateMasterCategories();
                Renderer.requestRedraw();
            }
        }

        function openCategoryEditor(category = null) {
            if (!categoryEditorModal) return;
            const isEditing = !!category;
            document.getElementById('category-editor-title').textContent = isEditing ? 'Edit category' : 'Add new category';
            document.getElementById('category-editor-original-name').value = isEditing ? category.name : '';
            document.getElementById('category-editor-name').value = isEditing ? category.name : '';
            document.getElementById('category-editor-color').value = isEditing ? category.color : '#888888';
            document.getElementById('category-editor-alt-color').value = isEditing ? category.altColor : '#999999';
            document.getElementById('category-editor-speed').value = isEditing ? category.speed : '150';
            document.getElementById('category-editor-pressure').value = isEditing ? category.pressure : '900';
            categoryEditorModal.style.display = 'flex';
        }

        categoryEditorModal = createCategoryEditorModal();
        refreshGUI();

        document.addEventListener('keydown', (e) => {
            if (suppresskeybinds || document.getElementById('category-editor-modal').style.display === 'flex') return;

            // handle arrow key point nudging
            if (AppState.getSelectedDot() && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const selectedDot = AppState.getSelectedDot();
                const nudgeAmount = 0.01;
                const originalLong = selectedDot.long;
                const originalLat = selectedDot.lat;

                switch (e.key) {
                    case 'ArrowUp': selectedDot.lat += nudgeAmount; break;
                    case 'ArrowDown': selectedDot.lat -= nudgeAmount; break;
                    case 'ArrowLeft': selectedDot.long -= nudgeAmount; break;
                    case 'ArrowRight': selectedDot.long += nudgeAmount; break;
                }

                selectedDot.lat = Utils.constrainLatitude(selectedDot.lat, Utils.mapViewHeight());
                selectedDot.long = Utils.normalizeLongitude(selectedDot.long);

                const selectedTrack = AppState.getSelectedTrack();
                History.record(History.ActionTypes.movePoint, {
                    trackIndex: AppState.getTracks().indexOf(selectedTrack),
                    pointIndex: selectedTrack.indexOf(selectedDot),
                    long0: originalLong,
                    lat0: originalLat,
                    long1: selectedDot.long,
                    lat1: selectedDot.lat
                });

                if (AppState.getAutosave()) Database.save();
                AppState.setNeedsIndexRebuild(true);
                Renderer.requestRedraw();
                if (refreshGUI) refreshGUI();
                return;
            }

            const k = e.key.toLowerCase();
            const keyActions = {
                'd': () => AppState.setCategoryToPlace(0),
                's': () => AppState.setCategoryToPlace(1),
                '1': () => AppState.setCategoryToPlace(2),
                '2': () => AppState.setCategoryToPlace(3),
                '3': () => AppState.setCategoryToPlace(4),
                '4': () => AppState.setCategoryToPlace(5),
                '5': () => AppState.setCategoryToPlace(6),
                'u': () => AppState.setCategoryToPlace(7),
                't': () => AppState.setTypeToPlace(0),
                'b': () => AppState.setTypeToPlace(1),
                'x': () => AppState.setTypeToPlace(2),
                ' ': () => Utils.deselectTrack(),
                'h': () => AppState.getSelectedTrack() && AppState.setHideNonSelectedTracks(!AppState.getHideNonSelectedTracks()),
                'q': () => AppState.setDeleteTrackPoints(!AppState.getDeleteTrackPoints()),
                'l': () => AppState.setUseAltColors(!AppState.getUseAltColors()),
                'p': () => {
                    const select = document.getElementById('dot-size-select');
                    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
                    select.dispatchEvent(new Event('change'));
                },
                'a': () => AppState.setAutosave(!AppState.getAutosave())
            };

            if ((k === 'z' || k === 'y') && e.ctrlKey) {
                e.preventDefault();
                (k === 'y' || e.shiftKey) ? History.redo() : History.undo();
                refreshGUI();
                return;
            }

            if (keyActions[k]) {
                e.preventDefault();
                keyActions[k]();
                refreshGUI();
            }
        });

        // Set up zoom slider reference for Renderer
        const canvasContainer = document.getElementById('canvas-container');
        const existingZoomWrap = document.getElementById('zoom-controls');
        if (existingZoomWrap) {
            zoomSliderEl = existingZoomWrap.querySelector('input[type="range"]');
        } else {
            zoomSliderEl = Renderer.createZoomControls(canvasContainer);
        }
    }

    return {
        init,
        getRefreshGUI: () => refreshGUI,
        getSuppressKeybinds: () => suppresskeybinds
    };
})();
