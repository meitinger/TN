'use strict';

/* Copyright (C) 2015, Manuel Meitinger
* 
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 2 of the License, or
* (at your option) any later version.
* 
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
* 
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/* jshint curly: true, eqeqeq: true, forin: false, freeze: true, latedef: nofunc, undef: true, unused: true */
/* globals angular: false, Handsontable: false, UIkit: false */

// define errors
function ArgumentException(message, paramName) {
    this.name = 'ArgumentException';
    this.message = message || 'Der Wert liegt außerhalb des erwarteten Bereichs.';
    if (paramName) {
        this.message += '\nParametername: ' + paramName;
    }
    this.paramName = paramName;
}
ArgumentException.prototype = Object.create(Error.prototype);
ArgumentException.prototype.constructor = ArgumentException;
function InvalidDataException(message) {
    this.name = 'InvalidDataException';
    this.message = message || 'Ungültige Daten beim Decodieren gefunden.';
}
InvalidDataException.prototype = Object.create(Error.prototype);
InvalidDataException.prototype.constructor = InvalidDataException;
function InvalidOperationException(message) {
    this.name = 'InvalidOperationException';
    this.message = message || 'Der Vorgang ist aufgrund des aktuellen Zustands des Objekts ungültig.';
}
InvalidOperationException.prototype = Object.create(Error.prototype);
InvalidOperationException.prototype.constructor = InvalidOperationException;
function UnauthorizedAccessException(message) {
    this.name = 'UnauthorizedAccessException';
    this.message = message || 'Es wurde versucht, einen nicht autorisierten Vorgang auszuführen.';
}
UnauthorizedAccessException.prototype = Object.create(Error.prototype);
UnauthorizedAccessException.prototype.constructor = UnauthorizedAccessException;
function ObjectDisposedException(objectName) {
    this.name = 'ObjectDisposedException';
    this.message = 'Auf das verworfene Objekt kann nicht zugegriffen werden.';
    if (objectName) {
        this.message += '\nObjektname: ' + objectName;
    }
    this.objectName = objectName;
}
ObjectDisposedException.prototype = Object.create(InvalidOperationException.prototype);
ObjectDisposedException.prototype.constructor = ObjectDisposedException;

// function that reports an error
UIkit.modal.error = function (src, msg, trace) {
    UIkit.modal.error = function () { };
    UIkit.modal.blockUI(
        '<h1>Jo, des is\' hin...</h1>' +
        '<p>Es ist ein unerwarteter Fehler aufgetreten.<br/>Die Meldung lautet:</p>' +
        '<p><b>' + msg + '</b></p>' +
        '<hr/>' +
        '<p><b>Bitte <a href="mailto:administrator@aufbauwerk.com?subject=[tn]%20' + encodeURIComponent(src) + '&amp;body=' + encodeURIComponent(trace) + '">melden</a> Sie den Fehler und laden Sie die Seite <a href="javascript:location.reload(true);">neu</a>.'
    );
};

// unhandled exception handler
window.onerror = function (msg, url, line) {
    UIkit.modal.error('window', msg, msg + '\n   at ' + url + ':' + line);
};

// define angular module
angular.module('tn', [])

// error handler
.factory('$exceptionHandler', function () {
    return function (exception) {
        UIkit.modal.error('angular', exception.message, exception.stack);
    };
})

// SQL states
.constant('SqlState', {
    PendingApproval: 0,
    Execute: 1,
    HasError: 2,
    Completed: 3,
    Aborted: 4,
    Failed: 5
})

// DB roles
.constant('Roles', {
    JobCoaching: 'Integrationsassistenz',
    Coaching: 'Training',
    Management: 'Leitung',
    Accounting: 'Rechnungswesen',
    Administration: 'Systemadministrator'//'Sekretariat'
})

// foreign row lookup names
.constant('ReferenceLabels', {
    'Teilnehmer': function (row) { return row.Nachname + ', ' + row.Vorname; },
    'Zeitspanne_Austrittsgrund': function (row) { return row.Bezeichnung; },
    'Bescheid_Typ': function (row) { return row.Bezeichnung; },
    'Standort_Bereich': function (row) { return row.Code + ' - ' + row.Bezeichnung; },
    'Praktikum_Kategorie': function (row) { return row.Bezeichnung; },
    'Einrichtung': function (row) { return row.Name; },
    'Leistungsart': function (row) { return row.Bezeichnung; },
    'Einheit': function (row) { return row.Bezeichnung; },
    'Rechnung': function (row) { return row.$id + " " + row.Bezeichnung; }
})

// SQL service
.service('sql', function ($q, $http, SqlState) {
    var svc = this;

    // bindable fields
    svc.commands = [];
    svc.reviewCommands = false;

    // reader helper function
    var reader = function (args, forceSingleSet, parser) {
        // create the deferred object and check the parameters
        var deferred = $q.defer();
        if (!angular.isObject(args)) {
            throw new ArgumentException('Ungültige oder fehlende Abfrageargumente.', 'args');
        }
        if (!angular.isString(args.description)) {
            throw new ArgumentException('Keine Abfragebeschreibung gefunden.', 'args');
        }
        if (!angular.isString(args.command)) {
            throw new ArgumentException('Abfragetext fehlt.', 'args');
        }
        if (angular.isDefined(args.parameters) && !angular.isObject(args.parameters)) {
            throw new ArgumentException('Abfrageparametersammlung ist kein Objekt.', 'args');
        }
        if (angular.isDefined(args.cancelOn) && !(angular.isObject(args.cancelOn) && args.cancelOn instanceof deferred.promise.constructor)) {
            throw new ArgumentException('Abbruchsereignis ist kein Promise.', 'args');
        }

        // define the commmand variable
        var command;

        // create the http config object
        var config = {
            method: 'POST',
            url: 'sql.ashx',
            params: { q: args.command, noCache: (new Date()).valueOf() },
            cache: false,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            transformRequest: angular.identity
        };
        if (args.parameters) {
            // type-check and encode the parameters
            var encodedParameters = [];
            for (var name in args.parameters) {
                var value = args.parameters[name];
                switch (typeof value) {
                    case 'number':
                        value = value.toString();
                        break;
                    case 'boolean':
                        value = value ? '1' : '0';
                        break;
                    case 'string':
                        value = encodeURIComponent(value);
                        break;
                    case 'object':
                        if (value instanceof Date) {
                            value = (new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds()))).toISOString();
                            break;
                        }
                        if (value === null) {
                            value = '';
                            break;
                        }
                        throw new ArgumentException('Der Objekttyp des Abfrageparameter "' + name + '" wird nicht unterstützt.', 'args');
                    default:
                        throw new ArgumentException('Der Typ des Abfrageparameter "' + name + '" ist ungültig.', 'args');
                }
                encodedParameters.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
            }

            // update the http config
            config.data = encodedParameters.join('&');
        }

        // handle cancellations
        var cancelled = false;
        if (args.cancelOn) {
            config.timeout = args.cancelOn.then(function (reason) {
                cancelled = true;
                if (command.state < SqlState.Completed) {
                    command.state = SqlState.Aborted;
                    command.error = reason;
                }
            });
        }

        // store internal flags
        var allowError = !!args.allowError;
        var singleSet = forceSingleSet || !!args.singleSet;

        // query helper
        var execute = function () {
            // set the state and reset the error
            command.state = SqlState.Execute;
            delete command.error;
            command.lastExecuteTime = new Date();
            $http(config).then(
	            function (response) {
	                // ensure not cancelled
	                if (cancelled) {
	                    return;
	                }

	                // check if the response include records
	                var data = response.data;
	                if (angular.isArray(data)) {
	                    // make sure the recordsets are valid and convert date objects
	                    for (var i = data.length - 1; i >= 0; i--) {
	                        var recordset = data[i];
	                        if (!angular.isObject(recordset) || !angular.isNumber(recordset.RecordsAffected) || !angular.isArray(recordset.Records)) {
	                            throw new InvalidDataException('Recorset #' + i + ' ist ungültig.');
	                        }
	                        var records = recordset.Records;
	                        for (var j = records.length - 1; j >= 0; j--) {
	                            var record = records[j];
	                            if (!angular.isObject(record)) {
	                                throw new InvalidDataException('Record #' + j + ' in Recorset #' + i + ' ist ungültig.');
	                            }
	                            for (var name in record) {
	                                var value = record[name];
	                                if (angular.isString(value)) {
	                                    var dateMatch = value.match(/^(\d\d\d\d)-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d\d\d)Z$/);
	                                    if (dateMatch) {
	                                        if ((new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(dateMatch[4]), Number(dateMatch[5]), Number(dateMatch[6]), Number(dateMatch[7])))).toISOString() !== value) {
	                                            throw new InvalidDataException('Ungültiges Datum in Wert "' + name + '" in Record #' + j + ' in Recorset #' + i + '.');
	                                        }
	                                        record[name] = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(dateMatch[4]), Number(dateMatch[5]), Number(dateMatch[6]), Number(dateMatch[7]));
	                                    }
	                                }
	                            }
	                        }
	                    }

	                    // ensure a single record set if requested
	                    if (singleSet) {
	                        if (data.length !== 1) {
	                            throw new InvalidDataException('Kein oder mehrere Recordsets wurden zurückgegeben.');
	                        }
	                        data = data[0];
	                    }

	                    // parse the data and resolve the promise
	                    data = parser(data);
	                    command.state = SqlState.Completed;
	                    deferred.resolve(data);
	                }

	                // check if the response is an error
	                else if (angular.isObject(data)) {
	                    // ensure a complete error object
	                    if (!angular.isNumber(data.CommandNumber) || !angular.isString(data.Message)) {
	                        throw new InvalidDataException('Ein ungültiges oder unvollständiges Fehlerobjekt wurde zurückgegeben.');
	                    }

	                    // check if this is a managed error
	                    var errorMatch = data.Message.match(/^(.*?)\s\[TN\](?:\[(.+?)\](?:\[(.+?)\])?)?/);
	                    command.error = errorMatch ?
                            ('Ungültige Daten: ' + errorMatch[1]) :
                            ('Datenbankfehler: ' + data.Message);
	                    if (!errorMatch || !allowError) {
	                        command.state = SqlState.HasError;
	                        return;
	                    }

	                    // replace the data with a proper error object
	                    data = {
	                        statement: data.CommandNumber,
	                        message: errorMatch[1],
	                        table: errorMatch[2],
	                        column: errorMatch[3]
	                    };

	                    // reject the promise
	                    command.state = SqlState.Failed;
	                    deferred.reject(data);
	                }

	                // otherwise throw an error
	                else {
	                    throw new InvalidDataException('Server sendete ungültige Daten.');
	                }
	            },
	            function (response) {
	                // ensure not cancelled
	                if (cancelled) {
	                    return;
	                }

	                // set the state and error
	                command.state = SqlState.HasError;
	                command.error = 'Übertragungsfehler: ' + response.statusText;
	            }
	        );
        };

        // push the command object
        command = {
            description: args.description,
            sql: args.command.replace(/[^@]@(\w+)/g, function (match, name) { return match[0] + '\'' + args.parameters[name] + '\''; }),
            abortable: allowError,
            state: SqlState.PendingApproval,
            approve: function () {
                if (command.state !== SqlState.PendingApproval) {
                    throw new InvalidOperationException('Der Befehl ist nicht im Überprüfungsmodus.');
                }
                execute();
            },
            retry: function () {
                if (command.state !== SqlState.HasError) {
                    throw new InvalidOperationException('Der Befehl kann nicht wiederholt werden.');
                }
                execute();
            },
            abort: function () {
                if (command.state !== SqlState.HasError || !allowError) {
                    throw new InvalidOperationException('Der Befehl kann nicht abgebrochen werden.');
                }
                command.state = SqlState.Aborted;
                deferred.reject({
                    statement: 0,
                    message: 'Der Vorgang wurde abgebrochen.',
                    table: null,
                    column: null
                });
            }
        };
        svc.commands.push(command);

        // execute the command if no review is necessary
        if (!svc.reviewCommands || !args.allowReview) {
            execute();
        }

        // return the promise
        return deferred.promise;
    };

    // member functions
    svc.scalar = function (args) {
        return reader(args, true, function (data) {
            if (data.Records.length > 1) {
                throw new InvalidDataException('Zu viele zurückgegebene Zeilen für einen Skalarwert.');
            }
            if (data.Records.length === 0) {
                return null;
            }
            var keys = Object.keys(data.Records[0]);
            if (keys.length !== 1) {
                throw new InvalidDataException('Es muss genau eine Spalte für einen Skalarwert abgefragt werden.');
            }
            return data.Records[0][keys[0]];
        });
    };
    svc.nonQuery = function (args) {
        return reader(args, true, function (data) {
            if (data.Records.length > 0) {
                throw new InvalidDataException('Ein abfragefreier SQL-Befehl darf keine Zeilen zurückgeben.');
            }
            return data.RecordsAffected;
        });
    };
    svc.query = function (args) {
        return reader(args, true, function (data) {
            if (data.RecordsAffected > 0) {
                throw new InvalidDataException('Eine Abfrage darf keine Zeilen ändern.');
            }
            return data.Records;
        });
    };
    svc.batch = function (args) {
        return reader(args, false, angular.identity);
    };
})

// notification service
.service('notification', function ($http, $timeout, $q) {

    // define the global vars
    var nextNotificationId = 0;
    var notifications = {};
    var lastEventId = -1;
    var readyEvent = $q.defer();

    // define the function object
    var notification = function (fn) {
        // check the input arguments
        if (!angular.isFunction(fn)) {
            throw new ArgumentException('Callbackfunktion erwartet.', 'fn');
        }

        // get the next id and increment the counter
        var id = nextNotificationId++;

        // get the deferred object and set its promise's notify function
        var deferred = $q.defer();
        var promise = deferred.promise;
        promise.then(null, null, fn);

        // add the notifcation
        notifications[id] = deferred;

        // set the promise id and return id
        promise.$notificationId = id;
        return promise;
    };

    // define the cancellation method
    notification.cancel = function (promise) {
        if (promise && promise.$notificationId in notifications) {
            notifications[promise.$notificationId].reject('cancelled');
            delete notifications[promise.$notificationId];
            return true;
        }
        return false;
    };

    // define the readiness callback function
    notification.ready = function (fn) {
        if (angular.isDefined(fn) && !angular.isFunction(fn)) {
            throw new ArgumentException('Callbackfunktion erwartet.', 'fn');
        }

        // set the callback if given and return the promise
        if (fn) {
            readyEvent.promise.then(fn);
        }
        return readyEvent.promise;
    };

    // define the query function
    var query = function () {
        $http({
            method: 'GET',
            url: 'notify.ashx',
            params: { lastEventId: lastEventId, noCache: (new Date()).valueOf() },
            cache: false,
            timeout: 60000
        }).then(
            function (response) {
                // check the data
                var data = response.data;
                if (!angular.isObject(data)) {
                    throw new InvalidDataException('Kein Ereignisobjekt empfangen.');
                }
                if (!angular.isNumber(data.LastEventId)) {
                    throw new InvalidDataException('Rückgabeobjekt enthält keine Ereignisnummer.');
                }
                if (data.LastEventId < 0) {
                    throw new InvalidDataException('Die Ereignisnummer ist negativ.');
                }
                var events = data.Events;
                if (!angular.isObject(events)) {
                    throw new InvalidDataException('Die Ereignissammlung ist ungültig.');
                }
                var hasEvents = false;
                for (var sourceName in events) {
                    var source = events[sourceName];
                    hasEvents = true;
                    if (!angular.isObject(source)) {
                        throw new InvalidDataException('Die Ereignisquelle "' + sourceName + '" ist kein Objekt.');
                    }
                    for (var id in source) {
                        if (!id.match(/^[1-9]\d*$/)) {
                            throw new InvalidDataException('ID "' + id + '" von Ereignisquelle "' + sourceName + '" ist nicht numerisch.');
                        }
                        var version = source[id];
                        if (version !== null && !(angular.isString(version) && version.match(/^0x[0-9A-F]{16}$/))) {
                            throw new InvalidDataException('Version von Ereignis #' + id + ' in Quelle "' + sourceName + '" ist ungültig.');
                        }
                    }
                }

                // set the last event id and reset the error
                var first = lastEventId === -1;
                delete notification.error;
                lastEventId = data.LastEventId;
                notification.lastSyncTime = new Date();

                // notify any readiness listeners and update the event time
                if (first) {
                    readyEvent.resolve();
                }
                if (hasEvents) {
                    notification.lastEventTime = new Date();
                }

                // notify the listeners
                for (var notificationId in notifications) {
                    notifications[notificationId].notify(events);
                }

                // requery
                query();
            },
			function (response) {
			    // there is a network error, try again soon
			    notification.error = response.statusText || "Zeitüberschreitung";
			    $timeout(query, 10000);
			}
		);
    };

    // initialize and return the notification function object
    query();
    return notification;
})

// define the table factory
.factory('table', function ($q, $rootScope, sql, notification) {
    return function (name, filter) {
        // check the input arguments
        if (!angular.isString(name) || !name.match(/^\w+$/)) {
            throw new ArgumentException('Der Tabellenname muss ein einfacher Bezeichner sein.', 'name');
        }
        if (angular.isDefined(filter) && (!angular.isString(filter) || filter.match(/^\s*WHERE(\s+|$)/i))) {
            throw new ArgumentException('Der Filter muss eine Zeichenfolge ohne WHERE-Prefix sein.', 'filter');
        }

        // define the table variable
        var table;

        // create the variables
        var disposed = false;
        var disposeDeferred = $q.defer();
        var disposePromise = disposeDeferred.promise;
        var nextNewRowId = -1;
        var notificationPromise = null;
        var rowIndex = {};
        var eventsBeforeReady = {};
        var readyEvent = $q.defer();
        var changeListeners = [];

        // wrap a function around a dispose checker
        var throwIfDisposed = function (fn) {
            return function () {
                if (disposed) {
                    throw new ObjectDisposedException('Tabelle ' + name);
                }
                return fn.apply(this, arguments);
            };
        };

        // call all row listeners asynchronously
        var notifyAsync = function (oldRow, newRow) {
            var callback = function (fn) {
                $rootScope.$evalAsync(function () { fn(table, oldRow, newRow); });
            };
            for (var i = changeListeners.length - 1; i >= 0; i--) {
                callback(changeListeners[i]);
            }
        };

        // makes sure the row exists and returns its index
        var indexOfRow = function (row) {
            for (var i = table.rows.length - 1; i >= 0; i--) {
                if (table.rows[i] === row) {
                    return i;
                }
            }
            throw new InvalidOperationException('Eine Zeile wurde außerhalb gelöscht.');
        };

        // define a method to index rows
        var indexAndCheckData = function (data, requeryIds) {
            for (var i = data.length - 1; i >= 0; i--) {
                var oldRow = null;
                var newRow = data[i];

                // ensure the entry is valid
                var id = newRow.$id;
                if (!angular.isNumber(id) || id < 1) {
                    throw new InvalidDataException('Ungültige ID gefunden.');
                }
                var version = newRow.$version;
                if (!angular.isString(version) || !version.match(/^0x[0-9A-F]{16}$/)) {
                    throw new InvalidDataException('Ungültige Version gefunden.');
                }
                var clonedEntry = {};
                var columns = table.columns;
                for (var j = columns.length - 1; j >= 0; j--) {
                    var columnName = columns[j].name;
                    var value = newRow[columnName];
                    if (value === void 0) {
                        throw new InvalidDataException('Wert für Spalte "' + columnName + '" nicht gefunden.');
                    }
                    clonedEntry[columnName] = value;
                }
                newRow.$orig = clonedEntry;

                // add the first rows or merge changed rows
                if (requeryIds === null) {
                    if (id in rowIndex) {
                        throw new InvalidDataException('Doppelte ID #' + id + ' gefunden.');
                    }
                    table.rows.push(newRow);
                    rowIndex[id] = newRow;
                }
                else {
                    // find and remove the id
                    var foundId = false;
                    for (var k = requeryIds.length - 1; k >= 0; k--) {
                        if (requeryIds[k] === id) {
                            foundId = true;
                            requeryIds.splice(k, 1);
                            break;
                        }
                    }
                    if (!foundId) {
                        throw new InvalidDataException('Doppelte oder nicht abgefragte ID #' + id + ' gefunden.');
                    }

                    // create an inserted or replace an updated row
                    if (id in rowIndex) {
                        oldRow = rowIndex[id];
                        if (newRow.$version <= oldRow.$version) {
                            continue;
                        }
                        table.rows[indexOfRow(oldRow)] = newRow;
                        rowIndex[id] = newRow;
                    }
                    else {
                        table.rows.push(newRow);
                        rowIndex[id] = newRow;
                    }
                }

                // notify the listeners
                notifyAsync(oldRow, newRow);
            }

            // remove all deleted rows
            if (requeryIds !== null) {
                for (var l = requeryIds.length - 1; l >= 0; l--) {
                    var deletedId = requeryIds[l];
                    if (deletedId in rowIndex) {
                        var deletedRow = rowIndex[deletedId];
                        table.rows.splice(indexOfRow(deletedRow), 1);
                        delete rowIndex[deletedId];
                        notifyAsync(deletedRow, null);
                    }
                }
            }
        };

        // helper function to update changed rows
        var handleNotifications = function (queryCommand, changedIds) {
            // get all ids that have to be requeried
            var requeryIds = [];
            for (var id in changedIds) {
                var version = changedIds[id];
                if (version === null) {
                    // check if the row is present
                    if (id in rowIndex) {
                        requeryIds.push(Number(id));
                    }
                }
                else {
                    // check if the version is newer or the row is missing
                    if (!(id in rowIndex) || version > rowIndex[id].$version) {
                        requeryIds.push(Number(id));
                    }
                }
            }

            // query the database if there are changed rows
            if (requeryIds.length > 0) {
                sql.query({
                    description: 'Geänderte Zeilen von Tabelle ' + name + ' abfragen',
                    command: queryCommand + (filter ? ' AND ' : '\nWHERE ') + 'ID IN (' + requeryIds.join(',') + ')',
                    cancelOn: disposePromise
                }).then(function (data) {
                    // merge the changed rows
                    indexAndCheckData(data, requeryIds);
                });
            }
        };

        // helper function for inserting, updating and deleting rows
        var rowAction = function (row, fn) {
            // check the row
            if (!angular.isObject(row) || !angular.isNumber(row.$id)) {
                throw new ArgumentException('Ungültige Tabellenzeile.', 'row');
            }
            if (!(row.$id in rowIndex) || rowIndex[row.$id] !== row) {
                throw new ArgumentException('Die Zeile befindet sich nicht (mehr) in der Tabelle.', 'row');
            }

            // create the deferred object
            var deferred = $q.defer();

            // make sure there is no other action and store this promise
            if (row.$action) {
                throw new InvalidOperationException('Es ist bereits ein Vorgang bei dieser Zeile aktiv.');
            }
            row.$action = deferred.promise;

            // run the action
            fn(row, deferred);

            // return the promise
            return deferred.promise;
        };

        // insert a new row
        var insertRow = function (row, deferred) {
            // get all columns that have a value set
            var columnsWithValue = [];
            var insertParameters = {};
            for (var i = table.columns.length - 1; i >= 0; i--) {
                var columnName = table.columns[i].name;
                var value = row[columnName];
                if (value !== void 0) {
                    insertParameters[columnName] = value;
                    columnsWithValue.push(columnName);
                }
            }
            sql.batch({
                description: 'Zeile in Tabelle ' + name + ' einfügen',
                command: 'INSERT INTO dbo.' + name + ' ' + (columnsWithValue.length === 0 ? 'DEFAULT VALUES' : ('(' + columnsWithValue.join(', ') + ')\n' +
                         'VALUES (@' + columnsWithValue.join(', @') + ')')) + '\n' +
                         'IF @@ERROR = 0\n' +
                         'BEGIN\n' +
                         '    SELECT SCOPE_IDENTITY() AS [$id]\n' +
                         (filter ? (
                         '    IF NOT EXISTS (SELECT * FROM dbo.' + name + ' WHERE ID = SCOPE_IDENTITY() AND (' + filter + ')) RAISERROR(\'Der Eintrag entspricht nicht dem Tabellenfilter. [TN][' + name + ']\', 16, 1)\n'
                         ) : '') +
                         'END',
                parameters: insertParameters,
                singleSet: true,
                allowReview: true,
                allowError: true,
                cancelOn: disposePromise
            }).then(
                function (batch) {
                    // check the batch result
                    if (batch.RecordsAffected === 0) {
                        throw new InvalidOperationException('Die Zeile wurde trotz Erfolg nicht in die Datenbank geschrieben.');
                    }
                    if (batch.Records.length === 0 || !angular.isNumber(batch.Records[0].$id)) {
                        throw new InvalidDataException('Die Rückgabewert von @@IDENTITY ist ungültig.');
                    }

                    // delete the temporary row and remember its index
                    var oldIndex = indexOfRow(row);
                    table.rows.splice(oldIndex, 1);
                    delete rowIndex[row.$id];
                    notifyAsync(row, null);

                    // update and reindex the row (if not done by an event already)
                    row.$id = batch.Records[0].$id;
                    for (var i = columnsWithValue.length - 1; i >= 0; i--) {
                        var columnName = columnsWithValue[i];
                        row.$orig[columnName] = row[columnName];
                    }
                    if (!(row.$id in rowIndex)) {
                        table.rows.splice(oldIndex, 0, row);
                        rowIndex[row.$id] = row;
                        notifyAsync(null, row);
                    }

                    // clear the action and error and resolve the promise
                    delete row.$error;
                    delete row.$action;
                    deferred.resolve(row);
                },
                function (error) {
                    // store the error, clear the action and reject the promise
                    row.$error = error;
                    delete row.$action;
                    deferred.reject(error.message);
                }
            );
        };

        // update an existing row
        var updateRow = function (row, deferred) {
            // get all changed columns
            var changedColumns = [];
            var updateQueryString = [];
            var updateParameters = {
                'ID': row.$id,
                'Version': row.$version
            };
            for (var i = table.columns.length - 1; i >= 0; i--) {
                var columnName = table.columns[i].name;
                var value = row[columnName];
                if (value !== void 0 && value !== row.$orig[columnName]) {
                    updateParameters[columnName] = value;
                    updateQueryString.push(columnName + ' = @' + columnName);
                    changedColumns.push(columnName);
                }
            }
            if (changedColumns.length === 0) {
                $rootScope.$evalAsync(function () {
                    // if nothing has changed notify the listeners
                    notifyAsync(row, row);

                    // clear the error and action and resolve the promise
                    delete row.$error;
                    delete row.$action;
                    deferred.resolve(row);
                });
            }
            else {
                // persist the changes
                sql.nonQuery({
                    description: 'Zeile in Tabelle ' + name + ' ändern',
                    command: 'UPDATE dbo.' + name + '\n' +
                             'SET ' + updateQueryString.join(', ') + '\n' +
                             'WHERE ID = @ID AND Version = @Version' +
                             (filter ? (';\n' +
                             'IF @@ROWCOUNT > 0 AND NOT EXISTS (SELECT * FROM dbo.' + name + ' WHERE ID = @ID AND (' + filter + ')) RAISERROR(\'Der Eintrag entspricht nicht dem Tabellenfilter. [TN][' + name + ']\', 16, 1)'
                             ) : ''),
                    parameters: updateParameters,
                    allowReview: true,
                    allowError: true,
                    cancelOn: disposePromise
                }).then(
                    function (recordsAffected) {
                        if (recordsAffected !== 0) {
                            // update the original columns
                            for (var i = changedColumns.length - 1; i >= 0; i--) {
                                var columnName = changedColumns[i];
                                row.$orig[columnName] = row[columnName];
                            }

                            // notify the listeners if the current row is still the same
                            if (row.$id in rowIndex && rowIndex[row.$id] === row) {
                                notifyAsync(row, row);
                            }

                            // clear the action and error and resolve the promise
                            delete row.$error;
                            delete row.$action;
                            deferred.resolve(row);
                        }
                        else {
                            // create an error, clear the action and reject the promise
                            var error = {
                                statement: 0,
                                message: 'Die Zeile wurde geändert oder bereits gelöscht.',
                                table: name,
                                column: null
                            };
                            row.$error = error;
                            delete row.$action;
                            deferred.reject(error.message);
                        }
                    },
                    function (error) {
                        // store the error, clear the action and reject the promise
                        row.$error = error;
                        delete row.$action;
                        deferred.reject(error.message);
                    }
                );
            }
        };

        var deleteRow = function (row, deferred) {
            if (row.$id < 0) {
                $rootScope.$evalAsync(function () {
                    // remove the unpersisted row
                    table.rows.splice(indexOfRow(row), 1);
                    delete rowIndex[row.$id];
                    notifyAsync(row, null);

                    // clear the action and resolve the promise
                    delete row.$action;
                    deferred.resolve(row);
                });
            }
            else {
                // remove the row from the database
                sql.nonQuery({
                    description: 'Zeile von Tabelle ' + name + ' löschen',
                    command: 'DELETE FROM dbo.' + name + ' WHERE ID = @ID AND Version = @Version',
                    parameters: {
                        'ID': row.$id,
                        'Version': row.$version
                    },
                    allowReview: true,
                    allowError: true,
                    cancelOn: disposePromise
                }).then(
                    function (recordsAffected) {
                        // delete the row if successful (and not done by notify), otherwise reject the promise
                        if (recordsAffected !== 0) {
                            if (row.$id in rowIndex) {
                                var currentRow = rowIndex[row.$id]; // NOTE: the row might have changed, so get the current one
                                table.rows.splice(indexOfRow(currentRow), 1);
                                delete rowIndex[row.$id];
                                notifyAsync(currentRow, null);
                            }

                            // clear the action and resolve the promise
                            delete row.$action;
                            deferred.resolve(row);
                        }
                        else {
                            // clear the action and reject the promise
                            delete row.$action;
                            deferred.reject('Die Zeile wurde geändert oder bereits gelöscht.');
                        }
                    },
                    function (error) {
                        // clear the action and reject the promise
                        delete row.$action;
                        deferred.reject(error.message);
                    }
                );
            }
        };

        // return the table object
        table = {
            dispose: function () {
                // dispose the object
                if (!disposed) {
                    disposeDeferred.resolve('Tabelle wird nicht mehr verwendet.');
                    if (notificationPromise) {
                        notification.cancel(notificationPromise);
                        notificationPromise = null;
                    }
                    rowIndex = void 0;
                    delete table.rows;
                    disposed = true;
                }
            },
            name: name,
            filter: filter,
            columns: [],
            rows: [],
            ready: throwIfDisposed(function (fn) {
                if (angular.isDefined(fn) && !angular.isFunction(fn)) {
                    throw new ArgumentException('Callbackfunktion erwartet.', 'fn');
                }

                // set the callback if given and return the promise
                if (fn) {
                    readyEvent.promise.then(fn);
                }
                return readyEvent.promise;
            }),
            addRowChangeListener: throwIfDisposed(function (fn) {
                if (!angular.isFunction(fn)) {
                    throw new ArgumentException('Callbackfunktion erwartet.', 'fn');
                }

                // add the listener
                for (var i = changeListeners.length - 1; i >= 0; i--) {
                    if (changeListeners[i] === fn) {
                        return false;
                    }
                }
                changeListeners.push(fn);
                return true;
            }),
            removeRowChangeListener: throwIfDisposed(function (fn) {
                if (!angular.isFunction(fn)) {
                    throw new ArgumentException('Callbackfunktion erwartet.', 'fn');
                }

                // remove the listener
                for (var i = changeListeners.length - 1; i >= 0; i--) {
                    if (changeListeners[i] === fn) {
                        changeListeners.splice(i, 1);
                        return true;
                    }
                }
                return false;
            }),
            getRowById: function (id) {
                // return the row at the index
                return rowIndex[id];
            },
            newRow: throwIfDisposed(function (row) {
                if (angular.isDefined(row) && !angular.isObject(row)) {
                    throw new ArgumentException('Vorlagenobjekt erwartet.', 'row');
                }

                // create and add a row
                if (!row) {
                    row = {};
                }
                row.$id = nextNewRowId--;
                row.$version = '0x0000000000000000';
                row.$orig = {};
                table.rows.push(row);
                rowIndex[row.$id] = row;
                notifyAsync(null, row);
                return row;
            }),
            saveRow: throwIfDisposed(function (row) {
                // insert or update a row
                return rowAction(row, row.$id < 0 ? insertRow : updateRow);
            }),
            deleteRow: throwIfDisposed(function (row) {
                return rowAction(row, deleteRow);
            })
        };

        // initialize the table when ready
        notification.ready(function () {
            // ensure we're not disposed
            if (disposed) {
                return;
            }

            // query the columns definition
            sql.query({
                description: 'Spaltendefinition von Tabelle ' + name + ' abfragen',
                command: 'SELECT\n' +
                         '  c.column_id AS id,\n' +
                         '  c.name,\n' +
                         '  t.name AS type,\n' +
                         '  c.max_length AS maxLength,\n' +
                         '  c.precision,\n' +
                         '  c.scale,\n' +
                         '  CASE WHEN c.is_nullable = 1 THEN 0 ELSE 1 END AS required,\n' +
                         '  CASE WHEN HAS_PERMS_BY_NAME(@Table,\'OBJECT\',\'UPDATE\',c.name,\'COLUMN\') = 1 THEN 0 ELSE 1 END AS readOnly,\n' +
                         '  OBJECT_NAME(f.referenced_object_id) AS [references]\n' +
                         'FROM\n' +
                         '  sys.columns AS c\n' +
                         '  JOIN\n' +
                         '  sys.types AS t ON c.user_type_id = t.user_type_id\n' +
                         '  LEFT OUTER JOIN\n' +
                         '  sys.foreign_key_columns AS f ON f.parent_object_id = c.object_id AND f.parent_column_id = c.column_id\n' +
                         'WHERE\n' +
                         '  c.object_id = OBJECT_ID(@Table) AND\n' +
                         '  HAS_PERMS_BY_NAME(@Table,\'OBJECT\',\'SELECT\',c.name,\'COLUMN\') = 1 AND\n' +
                         '  c.is_computed = 0\n' +
                         'ORDER BY c.column_id',
                parameters: { 'Table': 'dbo.' + name },
                cancelOn: disposePromise
            }).then(function (data) {
                // check and store the columns
                if (data.length === 0) {
                    throw new UnauthorizedAccessException('Keine sichtbaren Spalten in Tabelle ' + name + '.');
                }
                if (data[0].name !== 'ID') {
                    throw new InvalidDataException('Die erste sichtbare ' + name + '-Spalte ist nicht "ID".');
                }
                if (data[data.length - 1].name !== 'Version') {
                    throw new InvalidDataException('Die letzte sichtbare ' + name + '-Spalte ist nicht "Version".');
                }
                var queryCommand = 'SELECT ';
                for (var i = 1; i < data.length - 1; i++) {
                    var column = data[i];
                    table.columns.push(column);
                    queryCommand += column.name + ', ';
                }

                // create the base command
                queryCommand += 'ID AS [$id], Version AS [$version]\nFROM dbo.' + name;
                if (filter) {
                    queryCommand += '\nWHERE (' + filter + ')';
                }

                // register a notification for database events
                notificationPromise = notification(function (events) {
                    if (name in events) {
                        // queue events for later if not ready or handle them now
                        if (eventsBeforeReady !== null) {
                            var newEventsBeforeReady = events[name];
                            for (var id in newEventsBeforeReady) {
                                var newVersion = newEventsBeforeReady[id];
                                if (newVersion !== null && id in eventsBeforeReady) {
                                    var version = eventsBeforeReady[id];
                                    if (version === null || newVersion <= version) {
                                        continue;
                                    }
                                }
                                eventsBeforeReady[id] = newVersion;
                            }
                        }
                        else {
                            handleNotifications(queryCommand, events[name]);
                        }
                    }
                });

                // retrieve the rows
                sql.query({
                    description: (filter ? 'Gefilterte' : 'Alle') + ' Zeilen von Tabelle ' + name + ' abfragen',
                    command: queryCommand,
                    cancelOn: disposePromise
                }).then(function (data) {
                    // add the rows and handle all queued events
                    indexAndCheckData(data, null);
                    handleNotifications(queryCommand, eventsBeforeReady);
                    eventsBeforeReady = null;
                    readyEvent.resolve(table);
                });
            });
        });

        // return the table object
        return table;
    };
})

// define dataset functions
.service('dataSet', function ($q, ReferenceLabels, table) {
    // map structures
    var tables = {}; // tableName => table
    var references = {}; // tableName => array of hotInstance

    var initialize = function (hotInstance, settings) {
        // make sure the instance still exists
        if (hotInstance.tableName in references) {
            var hotInstances = references[hotInstance.tableName];
            for (var i = hotInstances.length - 1; i >= 0; i--) {
                if (hotInstances[i] === hotInstance) {
                    settings.columnSorting = true;
                    hotInstance.updateSettings(settings);
                    if (hotInstance.tableName in tables) {
                        hotInstance.loadData(tables[hotInstance.tableName].rows);
                    }
                    break;
                }
            }
        }

        /*
        var data = function (row) {
        // try to find the referenced row
        var id = row[columnName];
        if (id) {
        row = table.getRowById(id);

        // return either the lookup value or a missing reference string
        if (row)
        return lookup(row);
        else
        return '(' + tableName + ' #' + id + ' fehlt)';
        }
        else
        return '(leer)';
        };*/
    };

    // helper functions to render foreign keys and base tables
    var rowChange = function (table, oldRow, newRow) {
        // render all referencing hot tables
        if (oldRow || newRow) {
            var hotInstances = references[table.name];
            for (var i = hotInstances.length - 1; i >= 0; i--) {
                hotInstances[i].render();
            }
        }
    };
    var internalAddTable = function (table) {
        // hook the handler and provide existing views with data
        table.addRowChangeListener(rowChange);
        if (table.name in references) {
            var hotInstances = references[table.name];
            for (var i = hotInstances.length - 1; i >= 0; i--) {
                var hotInstance = hotInstances[i];
                if (hotInstance.tableName === table.name) {
                    hotInstance.loadData(table.rows);
                }
                hotInstance.render();
            }
        }
        else {
            references[table.name] = [];
        }
    };
    var internalRemoveTable = function (table) {
        // remove the table as view source and unhook the handler
        var hotInstances = references[table.name];
        for (var i = hotInstances.length - 1; i >= 0; i--) {
            var hotInstance = hotInstances[i];
            if (hotInstance.tableName === table.name) {
                hotInstance.loadData([]);
            }
            hotInstance.render();
        }
        table.removeRowChangeListener(rowChange);
    };

    // define the data set functions
    var dataSet = {
        ready: function (fn) {
            if (angular.isDefined(fn) && !angular.isFunction(fn)) {
                throw new ArgumentException('Callbackfunktion erwartet.', 'fn');
            }

            // combine all table ready states
            var promises = [];
            for (var tableName in tables) {
                promises.push(tables[tableName].ready());
            }
            var promise = $q.all(promises);

            // enlist the callback and return the combined promise
            if (fn) {
                promise.then(fn);
            }
            return promise;
        },
        load: function (definitions) {
            if (!angular.isArray(definitions) || definitions.some(function (definition) { return !angular.isString(definition.name) || angular.isDefined(definition.filter) && !angular.isString(definition.filter); })) {
                throw new ArgumentException('Name/Filter Liste erwartet.', 'definitions');
            }

            // store the old tables and reset the map
            var oldTables = tables;
            tables = {};

            // build the new maps
            for (var i = definitions.length - 1; i >= 0; i--) {
                var definition = definitions[i];
                if (definition.name in tables) {
                    throw new InvalidOperationException('Die Tabelle ' + definition.name + ' wurde versucht mehrfach zu laden.');
                }

                // check if the table can be reused
                if (definition.name in oldTables && oldTables[definition.name].filter === definition.filter) {
                    tables[definition.name] = oldTables[definition.name];
                    delete oldTables[definition.name];
                }
                else {
                    tables[definition.name] = table(definition.name, definition.filter);
                    internalAddTable(tables[definition.name]);
                }
            }

            // remove old unused tables
            for (var tableName in oldTables) {
                internalRemoveTable(oldTables[tableName]);
                oldTables[tableName].dispose();
            }
        },
        addTable: function (name, filter) {
            if (!angular.isString(name)) {
                throw new ArgumentException('Tabellenname erwartet.', 'name');
            }
            if (angular.isDefined(filter) && !angular.isString(filter)) {
                throw new ArgumentException('Zeichenkette erwartet.', 'filter');
            }
            if (name in tables) {
                throw new ArgumentException('Die Tabelle ' + name + ' existiert bereits.', 'name');
            }

            // add the table and hook its listener
            tables[name] = table(name, filter);
            internalAddTable(tables[name]);
            return tables[name];
        },
        removeTable: function (table) {
            if (!angular.isObject(table) || !angular.isString(table.name)) {
                throw new ArgumentException('Tabellenobjekt erwartet.', 'table');
            }
            if (!(table.name in tables) || tables[table.name] !== table) {
                throw new ArgumentException('Die Tabelle wurde nicht geladen.', 'table');
            }

            // remove the listener and delete the entry
            internalRemoveTable(table);
            delete tables[table.name];
            table.dispose();
        },
        primaryFilter: function (role, superRole) {
            if (!angular.isString(role)) {
                throw new ArgumentException('Zeichenkette erwartet.', 'role');
            }
            if (angular.isDefined(superRole) && !angular.isString(superRole)) {
                throw new ArgumentException('Zeichenkette erwartet.', 'superRole');
            }

            // create a permission filter for the Einrichtung table
            var filter = 'IS_MEMBER(SUSER_SNAME(' + role + ')) = 1';
            if (superRole) {
                filter += " OR IS_MEMBER('" + superRole + "') = 1";
            }
            return filter;
        },
        secondaryFilter: function (role, superRole) {
            if (!angular.isString(role)) {
                throw new ArgumentException('Zeichenkette erwartet.', 'role');
            }
            if (angular.isDefined(superRole) && !angular.isString(superRole)) {
                throw new ArgumentException('Zeichenkette erwartet.', 'superRole');
            }

            // create a permission filter for a table referencing Einrichtung
            return 'Einrichtung IN (SELECT ID FROM dbo.Einrichtung WHERE ' + dataSet.primaryFilter(role, superRole) + ')';
        },
        createView: function (tableName, parentElement, settings) {
            // check the arguments
            if (!angular.isString(tableName)) {
                throw new ArgumentException('Zeichenkette erwartet.', 'tableName');
            }
            if (!angular.isObject(parentElement)) {
                throw new ArgumentException('Container erwartet.', 'parentElement');
            }
            if (!angular.isObject(settings)) {
                throw new ArgumentException('Objekt erwartet.', 'settings');
            }
            if (!(tableName in tables)) {
                throw new ArgumentException('Die Tabelle "' + tableName + '" ist nicht eingeladen.', 'tableName');
            }

            // create and return the instance
            var hotInstance = new Handsontable(parentElement, { data: [] });
            hotInstance.tableName = tableName;
            references[tableName].push(hotInstance);
            tables[tableName].ready(function () { initialize(hotInstance, settings); });
            return hotInstance;
        },
        destroyView: function (hotInstance) {
            if (!angular.isObject(hotInstance) || !angular.isString(hotInstance.tableName)) {
                throw new ArgumentException('Ungültige Tabellenansicht.', 'hotInstance');
            }

            // delete the entry, unhook and destroy the handson table
            if (hotInstance.tableName in references) {
                var hotInstances = references[hotInstance.tableName];
                for (var i = hotInstances.length - 1; i >= 0; i--) {
                    if (hotInstances[i] === hotInstance) {
                        hotInstances.splice(i, 1);
                        hotInstance.destroy();
                        return;
                    }
                }
            }
            throw new ArgumentException('Die Tabellenansicht wurde nicht gefunden.', 'hotInstance');
        }
    };

    // return the data set functions
    return dataSet;
})

// define the trainee attendance controller
.controller('AttendanceController', function ($scope, $element, $filter, Roles, dataSet) {
    var ctr = this;
    var hot = null;

    // date helper functions
    var getDateFromWeekDay = function (weekDay) {
        return new Date(ctr.monday.getTime() + (((weekDay + 6) % 7) * (24 * 60 * 60 * 1000)));
    };
    var getMondayByWeekOffset = function (offset) {
        return new Date(ctr.monday.getTime() + (offset * 7 * 24 * 60 * 60 * 1000));
    };
    var getSundayByWeekOffset = function (offset) {
        return new Date(ctr.monday.getTime() + (((offset * 7) + 6) * 24 * 60 * 60 * 1000));
    };
    var formatTime = function (time) {
        // formats a date object into a 00:00 time string
        var result = '';
        var hours = time.getHours();
        var minutes = time.getMinutes();
        if (hours < 10) {
            result += '0';
        }
        result += hours;
        result += ':';
        if (minutes < 10) {
            result += '0';
        }
        result += minutes;
        return result;
    };

    // attendance variables and functions
    var attendance = {};
    var zeitspanne = null;
    var anwesenheit = null;
    var formatAnwesenheit = function (weekDays, weekDay) {
        // escape all entitites
        var escapeHtml = function (s) {
            var entityMap = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': '&quot;',
                "'": '&#39;',
                "/": '&#47;'
            };
            return s.replace(/[&<>"'\/]/g, function (ch) { return entityMap[ch]; });
        };

        // format the day to html
        var result = '<span class="bitmask-';
        if (weekDay in weekDays) {
            var row = weekDays[weekDay];
            result += (row.Vormittags ? '1' : '0') + (row.Nachmittags ? '1' : '0') + (row.Nachts ? '1' : '0') + '">';
            result += formatTime(row.Zusatz);
            result += '</span>';
            if (row.$action) {
                result += ' <i style="cursor:wait;" class="uk-icon-refresh uk-icon-spin"></i>';
            }
            else if (row.$error) {
                result += ' <i style="cursor:help;" data-uk-tooltip="data-uk-tooltip" title="' + escapeHtml(row.$error.message) + '" class="uk-icon-exclamation-triangle"></i>';
            }
        }
        else {
            result += '000 missing">00:00</span>';
        }

        // store the result and render
        weekDays.formatted[weekDay] = result;
        if (hot) {
            hot.render();
        }
    };
    var getWeekDays = function (zeitspanneId) {
        // create the weekdays if they don't exist
        if (!(zeitspanneId in attendance)) {
            var weekDays = { formatted: {} };
            for (var weekDay = 0; weekDay < 7; weekDay++) {
                formatAnwesenheit(weekDays, weekDay);
            }
            attendance[zeitspanneId] = weekDays;
        }
        return attendance[zeitspanneId];
    };
    var changeAnwesenheitAsync = function (zeitspanneId, weekDay, fn) {
        $scope.$evalAsync(function () {
            // get or create the row object
            var zeroTime = new Date(1900, 0, 1);
            var weekDays = getWeekDays(zeitspanneId);
            var row;
            if (weekDay in weekDays) {
                row = weekDays[weekDay];
                if (row.$action) {
                    UIkit.modal.alert('Die Zeile wird bereits geändert.');
                    return;
                }
            }
            else {
                row = {
                    Zeitspanne: zeitspanneId,
                    Datum: getDateFromWeekDay(weekDay),
                    Vormittags: false,
                    Nachmittags: false,
                    Nachts: false,
                    Zusatz: zeroTime
                };
                anwesenheit.newRow(row);
            }

            // change the row
            fn(row);

            // define a callback that updates the row
            var reformatAnwesenheit = function () {
                // make sure the row is sill the same
                if (weekDay in weekDays && weekDays[weekDay] === row) {
                    formatAnwesenheit(weekDays, weekDay);
                }
            };

            // save or delete the row if its empty
            if (!row.Vormittags && !row.Nachmittags && !row.Nachts && row.Zusatz.getTime() === zeroTime.getTime()) {
                anwesenheit.deleteRow(row).then(
                null,
                function (error) {
                    // also set an error and update the row
                    row.$error = {
                        statement: 0,
                        message: error,
                        table: 'Anwesenheit',
                        column: null
                    };
                    reformatAnwesenheit();
                }
            );
            }
            else {
                anwesenheit.saveRow(row).then(null, reformatAnwesenheit);
            }

            // update the row to indicate the action
            reformatAnwesenheit();
        });
    };
    var handleZeitspanneRowChange = function (table, oldRow, newRow) {
        // remove the html from the old row
        if (oldRow) {
            delete oldRow.$Anwesenheit;
        }

        // add the html to the new row
        if (newRow) {
            newRow.$Anwesenheit = getWeekDays(newRow.$id).formatted;
        }

        // rerender
        if (hot) {
            hot.render();
        }
    };
    var handleAnwesenheitRowChange = function (table, oldRow, newRow) {
        // define a helper function
        var doUpdate = function (row, fn) {
            if (row) {
                var weekDays = getWeekDays(row.Zeitspanne);
                var weekDay = row.Datum.getDay();
                if (fn(row, weekDays, weekDay)) {
                    formatAnwesenheit(weekDays, weekDay);
                }
            }
        };

        // remove the day if the old row exists and is not older
        doUpdate(oldRow, function (row, weekDays, weekDay) {
            if (!(weekDay in weekDays) || weekDays[weekDay].$version > row.$version) {
                return false;
            }
            delete weekDays[weekDay];
            return true;
        });

        // add the day if no row exists or the row is newer
        doUpdate(newRow, function (row, weekDays, weekDay) {
            if (weekDay in weekDays && weekDays[weekDay].$version > row.$version) {
                return false;
            }
            weekDays[weekDay] = row;
            return true;
        });
    };

    // holiday variables and functions
    var holidays = {};
    var feiertag = null;
    var handleFeiertagRowChange = function (table, oldRow, newRow) {
        var render = false;

        // remove old holidays and add new holidays
        if (oldRow) {
            var oldDay = oldRow.Datum.getDay();
            if (oldDay in holidays && holidays[oldDay].$version <= oldRow.$version) {
                delete holidays[oldDay];
                render = true;
            }
        }
        if (newRow) {
            var newDay = newRow.Datum.getDay();
            if (!(newDay in holidays) || newDay in holidays && holidays[newDay].$version <= newRow.$version) {
                holidays[newDay] = newRow;
                render = true;
            }
        }

        // redraw the header if possible and necessary
        if (hot && render) {
            hot.render();
        }
    };

    // handson table variable and build function
    var hotContainer = (function (children) { return children[children.length - 1]; })($element.children());
    var hotHeaders = function (col) {
        switch (col) {
            case 0: return 'Einrichtung';
            case 1: return 'Teilnehmer';
            default:
                // return either the holiday name or the formatted day string
                var weekDay = (col - 1) % 7;
                if (weekDay in holidays) {
                    return holidays[weekDay].Name;
                }
                return $filter('date')(getDateFromWeekDay(weekDay), 'EEE, d.M.');
        }
    };
    var hotBeforeChange = function (changes) {
        // create a function that sets all attributes
        var createSetter = function (vormittags, nachmittags, nachts, zusatz) {
            return function (row) {
                row.Vormittags = vormittags;
                row.Nachmittags = nachmittags;
                row.Nachts = nachts;
                row.Zusatz = zusatz;
            };
        };

        // go over all changes
        for (var i = changes.length - 1; i >= 0; i--) {
            var change = changes[i];

            // make sure the weekday is editable
            var propMatch = change[1].match(/^\$Anwesenheit\.([0-6])$/);
            if (!propMatch) {
                return;
            }
            var weekDay = Number(propMatch[1]);
            if (hot.getCellMeta(change[0], 2 + ((weekDay + 6) % 7)).readOnly) {
                return;
            }

            // make sure the format is value
            var valueMatch = change[3].match(/^<span class="bitmask-([01])([01])([01])( missing)?">(\d\d):(\d\d)<\/span>/);
            if (!valueMatch || valueMatch[5] >= 24 || valueMatch[6] >= 60) {
                return;
            }

            // change the attributes
            var zeitspanneId = hot.getSourceDataAtRow(change[0]).$id;
            changeAnwesenheitAsync(zeitspanneId, weekDay, createSetter(Number(valueMatch[1]) === 1, Number(valueMatch[2]) === 1, Number(valueMatch[3]) === 1, new Date(1900, 0, 1, Number(valueMatch[5]), Number(valueMatch[6]))));
        }
        return false;
    };
    var hotMouseDown = function (event, coords, TD) {
        // check the cell
        if (coords.row < 0 || coords.col < 2 || hot.getCellMeta(coords.row, coords.col).readOnly) {
            return;
        }

        // get the common variable and calculate the position
        var zeitspanneId = hot.getSourceDataAtRow(coords.row).$id;
        var weekDay = (coords.col - 1) % 7;
        var pos = event.clientX;
        for (var parent = TD; parent; parent = parent.offsetParent) {
            pos -= parent.offsetLeft;
        }
        if (pos < 4 || pos >= (angular.element(TD).find('span')[0].offsetWidth + 4)) {
            return;
        }

        // change the Anwesenheit depending on the click position
        if (pos > 37) {
            // set the new time
            var oldTime = zeitspanneId in attendance && weekDay in attendance[zeitspanneId] ?
                formatTime(attendance[zeitspanneId][weekDay].Zusatz) :
                '00:00';
            UIkit.modal.prompt("Zusatz:", oldTime, function (newTime) {
                var match = newTime.match(/^(\d\d):(\d\d)$/);
                if (match && Number(match[1]) < 24 && Number(match[2]) < 60) {
                    changeAnwesenheitAsync(zeitspanneId, weekDay, function (row) {
                        row.Zusatz = new Date(1900, 0, 1, Number(match[1]), Number(match[2]));
                    });
                }
                else {
                    UIkit.modal.alert('"' + newTime + '" ist keine gültige Uhrzeit.');
                }
            });
        }
        else {
            // toggle the states
            changeAnwesenheitAsync(zeitspanneId, weekDay, function (row) {
                if (pos < 22) {
                    if (row.Vormittags && row.Nachmittags) {
                        row.Vormittags = false;
                    }
                    else if (row.Vormittags) {
                        row.Nachmittags = true;
                    }
                    else if (row.Nachmittags) {
                        row.Nachmittags = false;
                    }
                    else {
                        row.Vormittags = true;
                    }
                }
                else {
                    row.Nachts = !row.Nachts;
                }
            });
        }
    };
    var hotColumns = (function () {
        // create the two main columns and add the day columns
        var columns = [
            { data: 'Einrichtung', width: 150, readOnly: true },
            { data: 'Teilnehmer', width: 250, readOnly: true }
        ];
        for (var i = 1; i <= 7; i++) {
            columns.push({ data: '$Anwesenheit.' + (i % 7), width: 100, renderer: "html", editor: false });
        }
        return columns;
    })();
    var hotCells = function (row, col) {
        var cellProperties = {};
        if (col > 1) {
            // mark days outside the Zeitspanne as readonly
            var weekDay = (col - 1) % 7;
            var date = getDateFromWeekDay(weekDay).getTime();
            var sourceRow = hot.getSourceDataAtRow(row);
            cellProperties.readOnly = !sourceRow || date < sourceRow.Eintritt.getTime() || sourceRow.Austritt && date > sourceRow.Austritt.getTime();

            // set the class name depending on the day
            cellProperties.className = 'attendance';
            if (weekDay in holidays) {
                cellProperties.className += ' holiday';
            }
            else if (col === 7) {
                cellProperties.className += ' saturday';
            }
            else if (col === 8) {
                cellProperties.className += ' sunday';
            }
        }
        return cellProperties;
    };

    // cleanup helper function
    var cleanup = function () {
        ctr.weeks = [];
        attendance = {};
        holidays = {};
        if (hot) {
            dataSet.destroyView(hot);
            hot = null;
        }
        if (zeitspanne) {
            zeitspanne.removeRowChangeListener(handleZeitspanneRowChange);
            dataSet.removeTable(zeitspanne);
            zeitspanne = null;
        }
        if (anwesenheit) {
            anwesenheit.removeRowChangeListener(handleAnwesenheitRowChange);
            dataSet.removeTable(anwesenheit);
            anwesenheit = null;
        }
        if (feiertag) {
            feiertag.removeRowChangeListener(handleFeiertagRowChange);
            dataSet.removeTable(feiertag);
            feiertag = null;
        }
    };

    // define the date variables and functions
    ctr.monday = (function (today) { return new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7)); })(new Date());
    ctr.sunday = getSundayByWeekOffset(0);
    ctr.maxMonday = getMondayByWeekOffset(2);
    ctr.weeks = [];
    ctr.updateWeek = function (incWeek) {
        // dispose old tables and maps
        cleanup();

        // adjust the dates and create the query parameters
        ctr.monday = getMondayByWeekOffset(incWeek);
        ctr.sunday = getSundayByWeekOffset(0);
        var begin = '\'' + new Date(Date.UTC(ctr.monday.getFullYear(), ctr.monday.getMonth(), ctr.monday.getDate())).toISOString() + '\'';
        var end = '\'' + new Date(Date.UTC(ctr.sunday.getFullYear(), ctr.sunday.getMonth(), ctr.sunday.getDate())).toISOString() + '\'';

        // populate the quick access menu
        for (var offset = -8; offset < 4; offset++) {
            var monday = getMondayByWeekOffset(offset);
            if (monday.getTime() > ctr.maxMonday.getTime()) {
                break;
            }
            ctr.weeks.push({
                monday: monday,
                sunday: getSundayByWeekOffset(offset),
                offset: offset
            });
        }

        // fetch all data that depends on the week
        zeitspanne = dataSet.addTable('Zeitspanne', 'Eintritt <= ' + end + ' AND (Austritt IS NULL OR Austritt >= ' + begin + ') AND (' + dataSet.secondaryFilter(Roles.Coaching, Roles.Administration) + ')');
        zeitspanne.addRowChangeListener(handleZeitspanneRowChange);
        anwesenheit = dataSet.addTable('Anwesenheit', 'Datum BETWEEN ' + begin + ' AND ' + end);
        anwesenheit.addRowChangeListener(handleAnwesenheitRowChange);
        feiertag = dataSet.addTable('Feiertag', 'Datum BETWEEN ' + begin + ' AND ' + end);
        feiertag.addRowChangeListener(handleFeiertagRowChange);

        // create the hot table when ready
        dataSet.ready(function () {
            hot = dataSet.createView('Zeitspanne', hotContainer, {
                colHeaders: hotHeaders,
                columns: hotColumns,
                cells: hotCells,
                beforeChange: hotBeforeChange,
                afterOnCellMouseDown: hotMouseDown
            });
        });
    };

    // make sure everything gets cleaned up
    $scope.$on('cleanup', cleanup);

    // show the current month
    ctr.updateWeek(0);
})

// controller for an ordinary table view
.controller('TableController', function ($q, $scope, $element, sql, dataSet) {
    var ctr = this;
    var hot = null;

    var cancelDeferred = $q.defer();
    ctr.initialize = function (tableName) {
        // ensure not already initializes
        if (hot) {
            throw new InvalidOperationException('Die Tabellenansicht wurde bereits initialisiert.');
        }
        if (!cancelDeferred) {
            throw new InvalidOperationException('Die Tabellenansicht wurde bereits freigegeben.');
        }

        // query the permissions
        sql.query({
            description: 'Berechtigungen an Tabelle ' + tableName + ' abfragen',
            command: 'SELECT\n' +
                     '  HAS_PERMS_BY_NAME(@Table,\'OBJECT\',\'INSERT\') AS allowNew,\n' +
                     '  HAS_PERMS_BY_NAME(@Table,\'OBJECT\',\'UPDATE\') AS allowEdit,\n' +
                     '  HAS_PERMS_BY_NAME(@Table,\'OBJECT\',\'DELETE\') AS allowDelete',
            parameters: { 'Table': 'dbo.' + tableName },
            cancelOn: cancelDeferred.promise
        }).then(function (data) {
            if (!cancelDeferred) {
                return;
            }
            cancelDeferred.reject();
            cancelDeferred = null;
            hot = dataSet.createView(tableName, $element[0], {
                minSpareRows: data.allowNew ? 1 : 0
            });
        });
    };
    $scope.$on('cleanup', function () {
        if (cancelDeferred) {
            cancelDeferred.resolve('Tabelle wird nicht mehr angezeigt.');
            cancelDeferred = null;
        }
        if (hot) {
            dataSet.destroyView(hot);
            hot = null;
        }
    });
})

// define the log area controller
.controller('LogController', function (sql, notification, SqlState) {
    var ctr = this;

    // controller variables
    ctr.sql = sql;
    ctr.notification = notification;
    ctr.filter = function (command) {
        return command.state !== SqlState.Completed || (new Date().getTime() - command.lastExecuteTime.getTime()) < 60000;
    };
})

// define the main scope controller
.controller('MainController', function ($scope, sql, Roles, dataSet) {
    var ctr = this;
    var toc = [];

    // define the navigational variables and functions
    ctr.navs = [];
    ctr.currentNav = -1;
    ctr.tabs = [];
    ctr.currentTab = -1;
    ctr.gotoNav = function (index) {
        if (!angular.isNumber(index) || index < 0 || index >= ctr.navs.length) {
            throw new ArgumentException('Ungültiger Navigationsindex.', 'index');
        }

        // do nothing if we're already there
        if (index === ctr.currentNav) {
            return;
        }

        // load the tables and build the tabs
        $scope.$broadcast('cleanup');
        ctr.tabs = [];
        var tables = toc[index].tables;
        dataSet.load(tables);
        ctr.tabs = toc[index].tabs.slice();
        for (var i = tables.length - 1; i >= 0; i--) {
            var table = tables[i];
            // add a tab if the table is not hidden
            if (!table.hidden) {
                ctr.tabs.push({ name: table.name, type: 'table' });
            }
        }

        // set the tab and nav index
        ctr.currentTab = ctr.tabs.length === 0 ? -1 : 0;
        ctr.currentNav = index;
    };
    ctr.gotoTab = function (index) {
        if (!angular.isNumber(index) || index < 0 || index >= ctr.tabs.length) {
            throw new ArgumentException('Ungültiger Registerkartenindex.', 'index');
        }

        // switch the current tab
        ctr.currentTab = index;
    };

    // query the role membership
    var initialize = function (entries) {
        var roleCommand = 'SELECT 1 AS [public]';
        for (var role in Roles) {
            roleCommand += ', IS_MEMBER(@' + role + ') AS [' + Roles[role] + ']';
        }
        sql.query({
            description: 'Rollenmitgliedschaft abfragen',
            command: roleCommand,
            parameters: Roles
        }).then(function (data) {
            // remove all entry from the toc that can't be accessed
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                var roles = entry.roles;
                for (var j = roles.length - 1; j >= 0; j--) {
                    if (data[0][roles[j]]) {
                        ctr.navs.push(entry.name);
                        toc.push(entry);
                        break;
                    }
                }
            }

            // make sure something is accessible
            if (ctr.navs.length === 0) {
                throw new UnauthorizedAccessException('Sie haben keine Berechtigung zum Ausführen dieser Anwendung.');
            }

            // select the nav if there is only one
            if (ctr.navs.length === 1) {
                ctr.gotoNav(0);
            }
        });
    };

    // define the content and initialize the app
    initialize([
        {
            name: 'Trainees und Bescheide',
            roles: [Roles.Management, Roles.Administration],
            tables: [
                { name: 'Teilnehmer' },
                { name: 'Zeitspanne', filter: dataSet.secondaryFilter(Roles.Management, Roles.Administration) },
                { name: 'Bescheid', filter: dataSet.secondaryFilter(Roles.Management, Roles.Administration) },
                { name: 'Zeitspanne_Austrittsgrund', hidden: true },
                { name: 'Bescheid_Typ', hidden: true },
                { name: 'Einrichtung', hidden: true, filter: dataSet.primaryFilter(Roles.Management, Roles.Administration) }
            ],
            tabs: []
        }, {
            name: 'Anwesenheiten',
            roles: [Roles.Coaching, Roles.Administration],
            tables: [
                { name: 'Teilnehmer', hidden: true },
                { name: 'Einrichtung', hidden: true, filter: dataSet.primaryFilter(Roles.Coaching, Roles.Administration) }
            ],
            tabs: [{ name: 'Teilnehmerliste', type: 'attendance'}]
        }, {
            name: 'Arbeitserprobungen',
            roles: [Roles.JobCoaching],
            tables: [
                { name: 'Praktikum' },
                { name: 'Standort' },
                { name: 'Teilnehmer', hidden: true },
                { name: 'Standort_Bereich', hidden: true },
                { name: 'Praktikum_Kategorie', hidden: true },
                { name: 'Einrichtung', hidden: true }
            ],
            tabs: []
        }, {
            name: 'Planung',
            roles: [Roles.Management, Roles.Accounting],
            tables: [
                { name: 'Planung', filter: dataSet.secondaryFilter(Roles.Management, Roles.Accounting) },
                { name: 'Leistungsart', hidden: true },
                { name: 'Einrichtung', hidden: true, filter: dataSet.primaryFilter(Roles.Management, Roles.Accounting) }
            ],
            tabs: []
        }, {
            name: 'Abrechnung',
            roles: [Roles.Accounting],
            tables: [
                { name: 'Rechnung', hidden: true },
                { name: 'Teilnehmer', hidden: true },
                { name: 'Einheit' },
                { name: 'Leistungsart' },
                { name: 'Kostensatz' },
                { name: 'Verrechnungssatz' }
            ],
            tabs: []
        }, {
            name: 'Systemtabellen',
            roles: [Roles.Administration],
            tables: [
                { name: 'Feiertag' },
                { name: 'Bescheid_Typ' },
                { name: 'Praktikum_Kategorie' },
                { name: 'Standort_Bereich' },
                { name: 'Zeitspanne_Austrittsgrund' },
                { name: 'Einrichtung' }
            ],
            tabs: []
        }
    ]);
});
