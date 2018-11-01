const {google} = require('googleapis')
const OAuth2 = google.auth.OAuth2

const COLS = 'BBBCDEFGHIJKLMNOPQRSTUVWXYZ'

module.exports = ({
  spreadsheetName,
  values,
  tableHeader,
}) => {
  const getExpensesSpreadsheet = async (drive) => new Promise(resolve => {
    drive.files.list({
      q: `name='${spreadsheetName}'`,
      fields: "files(id,name,trashed),kind,nextPageToken",
    }, (err, response) => {
      const {data} = response
      if (!data.files.length) {
        console.log('ERROR: NI MA PLIKÓW')
        resolve(null)

        return
      }

      const notTrashed = data.files.find(file => !file.trashed)

      if (!notTrashed) {
        console.log('ERROR: PLIKI TYLKO W KOSZU')
        resolve(null)

        return
      }

      resolve(notTrashed.id)
    })
  })

  const initializeExpensesSpreadsheet = async (sheets) => new Promise(resolve => {
    sheets.spreadsheets.create({
      fields: 'namedRanges/name,spreadsheetId,spreadsheetUrl',
      resource: {
        properties: {
          title: spreadsheetName,
        },
      }
    }, (error, response) => {
      if (error) {
        console.log(error)
        resolve(null)

        return
      }

      resolve(response.data.spreadsheetId)
    })
  })

  const initializeMonthSheet = async (sheets, spreadsheetId, sheetKey, sheetIdsToRemove) => new Promise(resolve => {
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetKey,
              },
            },
          },
          ...sheetIdsToRemove.map(sheetId => ({
            deleteSheet: {
              sheetId
            }
          }))
        ],
      },
    }, (sheetError, sheetResponse) => {
      if(sheetError) {
        console.log("SHEET ERROR", sheetError)

        resolve({error: sheetError})

        return
      }

      const {data: sheetData} = sheetResponse

      const lastColumn = COLS[tableHeader.length]
      const tableHeaderRow = values.length + 1

      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [{
            range: `${sheetKey}!A1:${lastColumn}${tableHeaderRow}`,
            majorDimension: "ROWS",
            values: [...values.map(({label, initialValue}) => [label, initialValue]), tableHeader.map(({label}) => label)]
          }]
        }
      }, (error, response) => {
        if (error) {
          console.log("error", error)
          resolve({error})

          return
        }

        resolve(response.data)
      })
    })
  })

  const getSpreadsheet = async (sheets, spreadsheetId) => new Promise(resolve => {
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties'
    }, (error, response) => {
      if (error) {
        resolve({error})

        return
      }

      resolve(response.data)
    })
  })

  const ensureSpreadsheet = async (sheets, drive, sheetKey) => {
    let expensesSpreadsheetId = await getExpensesSpreadsheet(drive)
    const removeDefaultSheet = !Boolean(expensesSpreadsheetId)

    if (!expensesSpreadsheetId) {
      expensesSpreadsheetId = await initializeExpensesSpreadsheet(sheets)
    }

    const spreadsheet = await getSpreadsheet(sheets, expensesSpreadsheetId)

    if (!spreadsheet.sheets.find(sheet => sheet.properties.title ===  sheetKey)) {
      const sheetsToRemove = removeDefaultSheet
        ? spreadsheet.sheets.map(sheet => sheet.properties.sheetId)
        : []

      await initializeMonthSheet(sheets, expensesSpreadsheetId, sheetKey, sheetsToRemove)
    }

    return expensesSpreadsheetId
  }

  return async ({
    clientId, secret, accessToken, sheetKey
  }) => {
    const oauthClient = new OAuth2(clientId, secret)

    oauthClient.setCredentials({
      access_token: accessToken,
    })

    const drive = google.drive({
      version: 'v3',
      auth: oauthClient,
    })

    const sheets = google.sheets({
      version: 'v4',
      auth: oauthClient
    })

    const expensesSpreadsheetId = await ensureSpreadsheet(sheets, drive, sheetKey)

    const lastColumn = COLS[tableHeader.length]

    return {
      getAllData: () => new Promise(resolve => {
        sheets.spreadsheets.values.get({
          spreadsheetId: expensesSpreadsheetId,
          range: `${sheetKey}!A1:${lastColumn}`
        }, (error, response) => {
          if (error) {
            resolve({error})

            return
          }

          const result = {}

          values.forEach(({key, format}, index) => {
            const [_label, value] = response.data.values[index]

            result[key] = format
              ? format(value)
              : value
          })

          const valuesInTable = response.data.values.slice(values.length + 1)

          result.values = valuesInTable.map(row => {
            const formattedRow = {}

            tableHeader.forEach(({key, format}, index) => {
              formattedRow[key] = format
                ? format(row[index])
                : row[index]
            })

            return formattedRow
          })

          resolve(result)
        })
      }),
      updateValues: (update) => new Promise(resolve => {
        const sheetUpdates = values.map(({key}, index) => {
          if (!Object.keys(update).includes(key)) {
            return null
          }

          return {
            range: `${sheetKey}!B${index + 1}`,
            majorDimension: "ROWS",
            values: [[update[key]]]
          }
        }).filter(a => Boolean(a))

        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: expensesSpreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: sheetUpdates,
          }
        }, (error, response) => {
          if (error) {
            console.log("error", error)
            resolve({errors: [error.message]})

            return
          }

          resolve({ok: true})
        })
      }),
      append: (row) => new Promise(resolve => {
        const dataTableStart = values.length + 1

        const rowToInput = tableHeader.map(({key}) => row[key])

        sheets.spreadsheets.values.append({
          spreadsheetId: expensesSpreadsheetId,
          range: `${sheetKey}!A${dataTableStart}`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [rowToInput],
          },
        }, (err, result) => {
          if (err) {
            resolve({errors: [err.message]})

            return
          }

          resolve({ok: true})
        })
      })
    }
  }
}
