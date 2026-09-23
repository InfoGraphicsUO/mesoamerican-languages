
The `side-panel` & the `legend` are mostly functionally doing the same thing. Since the colors represented by language families (and groups, for the Otomanguean) are present in the `side-panel` menu, the `legend` is a bit redundant. The one important feature in the legend that isn't explained elsewhere is the "Respondent Location Type" section, explaining the difference between the 'plus' and 'circle' symbology for the language points. 

Thus, I think it would be best to consolidate the `legend` and the `side-panel` into just the `side-panel` and display the respondent location type information within the side panel instead. We already do this on mobile and it works well.

This would make room for a new panel, which I will call `find-interpreters-panel`, or simply "Find interpreters". This will take the lookup table from [the Sharepoint table](https://uoregon.sharepoint.com/:x:/s/InvisibleNoMore/IQDzPbBmPfYWSY91wdfUA-HiARjrxZwMHUXVJWD7-oqcVQ4?e=R3T0gJ) to provide users with relevant contact info for the family/group/language they are viewing. 

Relevant columns from the entire spreadsheet:
- Interpreters Details sheet
	- service_type
	- oregon_relevance
	- languages_published
	- primary_source_url
	- Contact/Request URL
	- phone_number
	- contact_email
- Interpreters by Family / Languages by interpreter - pivot tables that organize details by relevant groupings

### Steps
- Remove legend
- Add "Respondent Location Type" to side panel similar to how we have it on mobile already
- Link sharepoint data to repo/site
- Build interpreter panel

### Functionality
- User will sort through side panel work flow (family, groups, languages, places) as they do now
- Once they begin sorting through, a new button thats on the side panel will be able to be pressed "Find interpreters"
- Pressing this button will open up the new panel
- New panel will detail all of the available interpreters. It will be sorted by Group/Language/Place depending on the level of filter the user was at when they pressed find interpreter
- Panel will have a top-right x close button to get rid of the panel

### Display (desktop)
- Side panel will be moved to the bottom left now permanently, as opposed to its current position in the top left
- When interpreter panel is opened, it will appear at the top left
- Interpreter panel features:
	- Title of the panel saying "Find interpreters"
	- Organized list of interpreters
	- Pressing an interpreter will move the user into a new section where the contact info was provided, with a back arrow to get back to the main interpreters list
		- This will replace the title with "Contact info"

### Display (mobile)
- After a user clicks a Family/Group/Language/Place from the mobile menu and the menu collapses to view it on the map, a new button will appear above the mapbox attribution div saying "Find interpreters"
- Pressing the button will open up the menu again, but it will be transformed into a similar interpreters menu
- It will display things similar to desktop but preserve the "EN/ES" language picker, the "Menu" title label will change to "Find interpreters" , and to the left of the title will be a back button to bring the user back to the menu. 
- Pressing the find interpreters will automatically open the menu section to its fullest extent
- The floating find interpreters button on the map will grey out (it will be greyed out always until the user taps on any map features or taps on one of the family/group/languages in the menu)

### Style
- Should be very consistent with what we have established so far with the side panel/menus and ui items
- Color coding groups/languages/families where appropriate in the new panel
- No added syntax/verbage except what was explicitly stated already (no eyebrows, no cards, etc)
- UI style implementation that wasnt specified in these instructions should be lazy and barebones so that its easy to build off of later and theres no random dead code hanging around that we will have to get rid of

