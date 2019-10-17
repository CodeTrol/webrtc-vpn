/*
 * Copyright (c) 2010-2014 BinarySEC SAS
 * Tuntap binding for nodejs [http://www.binarysec.com]
 * 
 * This file is part of Gate.js.
 * 
 * Gate.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

#ifndef _H_NODETUNTAP_ETHERTYPES
#define _H_NODETUNTAP_ETHERTYPES

class EtherTypes {
	public:
		static uint8_t getId(uint16_t type);
		static uint16_t getType(uint8_t key);
		
	private:
		EtherTypes();
		
		static EtherTypes singleton;
		
		int type_count;
		uint16_t *id2type;
		uint8_t *type2id;
};

#endif
